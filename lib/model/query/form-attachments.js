// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Form Attachments are files that are expected to exist given the XForms xml
// definition that the form was created with. See the instance/form-attachments
// file for more information.

const { sql } = require('slonik');
const { map, mergeRight } = require('ramda');
const { expectedFormAttachments } = require('../../data/schema');
const { Frame, into } = require('../frame');
const { Blob, Form } = require('../frames');
const { QueryOptions, unjoiner, insertMany, sqlEquals } = require('../../util/db');
const { ignoringResult, resolve } = require('../../util/promise');
const { construct } = require('../../util/util');
const Option = require('../../util/option');


////////////////////////////////////////////////////////////////////////////////
// CREATING ATTACHMENT SLOTS

// deal with itemsets.csv in both createNew and createVersion by hijacking the incoming
// data and patching in a new blobId.
// TODO: this is absolutely awful.
const itemsetsHack = (Blobs, itemsets) => ([expected, extant]) => {
  if (itemsets == null) return resolve(expected);
  const target = expected.find((a) => a.name === 'itemsets.csv');
  if (target == null) return resolve(expected);

  return Blobs.ensure(Blob.fromBuffer(Buffer.from(itemsets, 'utf8'), 'text/csv'))
    .then((id) => {
      // for createNew, we only need to splice the blobId into expectedAttachments.
      // but for createVersion, there is an extantAttachments: Array[FormAttachment] that
      // we might need to also patch, since that's what will be copied/carried forward.
      //
      // we still have to do both in this case, in case the old form did not expect
      // itemsets but the new one does.
      target.blobId = id;
      if (extant != null) {
        const extantTarget = extant.find((a) => a.name === 'itemsets.csv');
        if (extantTarget != null) {
          extantTarget.blobId = id;
          extantTarget.updatedAt = new Date();
        }
      }
      return expected;
    });
};

const createNew = (xml, form, itemsets) => ({ Blobs, Datasets, run }) =>
  expectedFormAttachments(xml)
    .then((expected) => [expected])
    .then(itemsetsHack(Blobs, itemsets))
    .then((expected) =>
      Datasets.getList(form.projectId)
        .then(datasets => {
          const dsHashtable = datasets.reduce((acc, ds) => Object.assign(acc, { [`${ds.name}.csv`]: ds }), {});
          const ids = { formId: form.id, formDefId: form.def.id };
          const attachments = expected.map((att) => {
            // we don't want to set datasetId for "fast external itemsets" cb#673
            const datasetId = !(itemsets && att.name === 'itemsets.csv') && att.type === 'file' ? dsHashtable[att.name]?.id : null;
            return new Form.Attachment({ ...att,
              ...ids,
              datasetId });
          });
          return run(insertMany(attachments));
        }));

const createVersion = (xml, form, savedDef, itemsets, publish = false) => ({ Blobs, FormAttachments, run }) =>
  Promise.all([
    // parse the new xml for attachments.
    expectedFormAttachments(xml),
    // and get the current attachments back out of the database. if publishing, always
    // copy from published. if draft, try to copy from extant draft, or else copy from
    // published.
    FormAttachments.getAllByFormDefId((publish === true)
      ? form.currentDefId : (form.draftDefId || form.currentDefId)),
  ])
    .then(ignoringResult(itemsetsHack(Blobs, itemsets)))
    .then(([expecteds, extants]) => {
      // deal with attachments. match up extant ones with now-expected ones,
      // and in general save the expected attachments into the database.
      const extantsMap = new Map(extants.map(a => [a.name, a]));
      const attachments = expecteds.map((expected) => {
        const extant = Option.of(extantsMap.get(expected.name)).filter((e) => e.type === expected.type);
        return new Form.Attachment(mergeRight({
          formId: form.id,
          formDefId: savedDef.id,
          blobId: extant.map((e) => e.blobId).orElse(undefined),
          // If extant has datasetId we use that
          // otherwise we we try to link dataset
          // only if extant doesn't even have a blobId
          datasetId: extant.map((e) => e.datasetId).orElse(undefined),
          updatedAt: extant.map((e) => e.updatedAt).orElse(undefined)
        }, expected));
      });

      return run(insertMany(attachments));
    });


////////////////////////////////////////////////////////////////////////////////
// UPDATING

const update = (_, fa, blobId, datasetId = null) => ({ one }) => one(sql`
  update form_attachments set "blobId"=${blobId}, "datasetId"=${datasetId}, "updatedAt"=clock_timestamp()
    where "formId"=${fa.formId} and "formDefId"=${fa.formDefId} and name=${fa.name}
    returning *`).then(construct(Form.Attachment));
update.audit = (form, fa, blobId, datasetId = null) => (log) => log('form.attachment.update', form,
  { formDefId: form.draftDefId, name: fa.name, oldBlobId: fa.blobId, newBlobId: blobId, oldDatasetId: fa.datasetId, newDatasetId: datasetId });

const autoLinkWithDataset = (form, datasetId) => async ({ FormAttachments, Datasets }) => {
  const dataset = await Datasets.getById(datasetId).then(o => o.get());
  const attachment = await FormAttachments.getByFormDefIdAndName(form.def.id, `${dataset.name}.csv`).then(a => a.orNull());
  if (attachment != null
    && attachment.type === 'file' && attachment.name !== 'itemsets.csv'
    && attachment.blobId == null && attachment.datasetId == null) {
    await FormAttachments.update(form, attachment, null, dataset.id);
  }
};

////////////////////////////////////////////////////////////////////////////////
// GETTERS

// This unjoiner pulls md5 from blob table (if it exists) and adds it to attachment frame
const _unjoinMd5 = unjoiner(Form.Attachment, Frame.define(into('blob'), 'md5'));

const _get = (exec, options) =>
  exec(sql`select ${_unjoinMd5.fields} from form_attachments
  left outer join (select id, md5 from blobs) as blobs on form_attachments."blobId"=blobs.id
  where ${sqlEquals(options.condition)} order by name asc`)
    .then(map(_unjoinMd5));

const getAllByFormDefId = (formDefId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ formDefId }));

const getByFormDefIdAndName = (formDefId, name, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ formDefId, name }));

////////////////////////////////////////////////////////////////////////////////
// EXTENDED GETTERS for Open Rosa

// Augments an attachment with OpenRosa-specific fields (openRosaHash, datasetType, filteredByAuth).
// For blob attachments, uses the blob md5 directly.
// For dataset attachments, uses pre-fetched metadata (see getMetadataForOpenRosa in datasets.js).
// The resulting fields are consumed by formManifest() in formats/openrosa.js.
const _augmentWithOpenRosaFields = (attachment, datasetMetadata) => {
  if (attachment.blobId) return attachment.with({ openRosaHash: attachment.aux.blob.md5 });
  if (attachment.datasetId) return attachment.with(datasetMetadata.get(attachment.datasetId) ?? { openRosaHash: null });
  return attachment.with({ openRosaHash: null });
};

const getAllByFormDefIdForOpenRosa = (formDefId, filterActorId = null) => async ({ all, Datasets }) => {
  const attachments = await _get(all, QueryOptions.none.withCondition({ formDefId }));
  const datasetIds = attachments.filter(a => a.datasetId != null).map(a => a.datasetId);
  const datasetMetadata = await Datasets.getMetadataForOpenRosa(datasetIds, filterActorId);
  return attachments.map((attachment) => _augmentWithOpenRosaFields(attachment, datasetMetadata));
};

const getByFormDefIdAndNameForOpenRosa = (formDefId, name, filterActorId = null) => async ({ maybeOne, Datasets }) => {
  const maybeAttachment = await _get(maybeOne, QueryOptions.none.withCondition({ formDefId, name }));
  const datasetIds = maybeAttachment.filter(a => a.datasetId != null).map(a => [a.datasetId]).orElse([]);
  const datasetMetadata = await Datasets.getMetadataForOpenRosa(datasetIds, filterActorId);
  return maybeAttachment.map((attachment) => _augmentWithOpenRosaFields(attachment, datasetMetadata));
};


module.exports = {
  createNew, createVersion,
  update,
  autoLinkWithDataset,
  getAllByFormDefId, getByFormDefIdAndName,
  getAllByFormDefIdForOpenRosa, getByFormDefIdAndNameForOpenRosa
};

