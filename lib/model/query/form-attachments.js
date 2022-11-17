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
const { unjoiner, insertMany } = require('../../util/db');
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
      Datasets.getAllByProjectId(form.projectId)
        .then(datasets => {
          const dsHashtable = datasets.reduce((acc, ds) => Object.assign(acc, { [`${ds.name}.csv`]: ds }), {});
          const ids = { formId: form.id, formDefId: form.def.id };
          return run(insertMany(expected.map((att) => new Form.Attachment(Object.assign({}, att, ids, { datasetId: att.type === 'file' ? dsHashtable[att.name]?.id : null })))));
        }));

const createVersion = (xml, form, savedDef, itemsets, publish = false) => ({ Blobs, FormAttachments, Datasets, run }) =>
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
    .then(([expecteds, extants]) =>
      Datasets.getAllByProjectId(form.projectId)
        .then(datasets => {
          const dsHashtable = datasets.reduce((acc, ds) => Object.assign(acc, { [`${ds.name}.csv`]: ds }), {});
          // deal with attachments. match up extant ones with now-expected ones,
          // and in general save the expected attachments into the database.
          const lookup = {}; // sigh javascript.
          if (expecteds.length > 0) // don't do this if we won't need it anyway.
            for (const attachment of extants)
              lookup[attachment.name] = attachment;

          const attachments = expecteds.map((expected) => {
            const extant = Option.of(lookup[expected.name]).filter((e) => e.type === expected.type);
            const matchingDsId = expected.type === 'file' ? Option.of(dsHashtable[expected.name]).map(d => d.id) : Option.none();
            return new Form.Attachment(mergeRight({
              formId: form.id,
              formDefId: savedDef.id,
              blobId: extant.map((e) => e.blobId).orElse(undefined),
              // If extant has datasetId we use that
              // otherwise we we try to link dataset
              // only if extant doesn't even have a blobId
              datasetId: extant.map((e) => e.datasetId)
                .orElse(matchingDsId.filter(() => extant.map(e => e.blobId).isEmpty())
                  .orElse(undefined)),
              updatedAt: extant.map((e) => e.updatedAt).orElse(undefined)
            }, expected));
          });

          return run(insertMany(attachments));
        }));


////////////////////////////////////////////////////////////////////////////////
// CRUD

const update = (_, fa, blobId, datasetId = null) => ({ one }) => one(sql`
  update form_attachments set "blobId"=${blobId}, "datasetId"=${datasetId}, "updatedAt"=clock_timestamp()
    where "formId"=${fa.formId} and "formDefId"=${fa.formDefId} and name=${fa.name}
    returning *`).then(construct(Form.Attachment));
update.audit = (form, fa, blobId, datasetId = null) => (log) => log('form.attachment.update', form,
  { formDefId: form.draftDefId, name: fa.name, oldBlobId: fa.blobId, newBlobId: blobId, oldDatasetId: fa.datasetId, newDatasetId: datasetId });


////////////////////////////////////////////////////////////////////////////////
// GETTERS

const getAllByFormDefId = (formDefId) => ({ all }) =>
  all(sql`select * from form_attachments where "formDefId"=${formDefId} order by name asc`)
    .then(map(construct(Form.Attachment)));

const getByFormDefIdAndName = (formDefId, name) => ({ maybeOne }) => maybeOne(sql`
select * from form_attachments where "formDefId"=${formDefId} and "name"=${name}`)
  .then(map(construct(Form.Attachment)));

// TODO: bad name
const _unjoinMd5 = unjoiner(Form.Attachment, Frame.define(into('openRosa'), 'md5', 'dsUpdatedAt'));
const getAllByFormDefIdForOpenRosa = (formDefId) => ({ all }) => all(sql`
select ${_unjoinMd5.fields} from form_attachments
  left outer join (select id, md5 from blobs) as blobs on form_attachments."blobId"=blobs.id
  left outer join (
    select d.id, max(e."updatedAt") "dsUpdatedAt" from datasets d left outer join entities e on d.id = e."datasetId" group by d.id
  ) as ds on form_attachments."datasetId"=ds.id
  where "formDefId"=${formDefId}`)
  .then(map(_unjoinMd5));


module.exports = {
  createNew, createVersion,
  update,
  getAllByFormDefId, getByFormDefIdAndName, getAllByFormDefIdForOpenRosa
};

