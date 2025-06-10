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
const { md5sum } = require('../../util/crypto');


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
      Datasets.getList(form.projectId)
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
            const matchingDsId = !(itemsets && expected.name === 'itemsets.csv') && expected.type === 'file' ? Option.of(dsHashtable[expected.name]).map(d => d.id) : Option.none();
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
// UPDATING

const update = (_, fa, blobId, datasetId = null) => ({ one }) => one(sql`
  update form_attachments set "blobId"=${blobId}, "datasetId"=${datasetId}, "updatedAt"=clock_timestamp()
    where "formId"=${fa.formId} and "formDefId"=${fa.formDefId} and name=${fa.name}
    returning *`).then(construct(Form.Attachment));
update.audit = (form, fa, blobId, datasetId = null) => (log) => log('form.attachment.update', form,
  { formDefId: form.draftDefId, name: fa.name, oldBlobId: fa.blobId, newBlobId: blobId, oldDatasetId: fa.datasetId, newDatasetId: datasetId });


////////////////////////////////////////////////////////////////////////////////
// GETTERS

// This unjoiner pulls md5 from blob table (if it exists) and adds it to attachment frame.
// Also adds dataset metadata if datasetMetadata is true,
// (similar query Datasets.getLastUpdateTimestamp)
const _unjoin = (datasetMetadata, actorId) => {
  const frames = [Form.Attachment, Frame.define(into('blob'), 'md5')];

  if (datasetMetadata) {
    const fields = ['approvalRequired', 'ownerOnly', 'lastAudit'];
    if (actorId != null) fields.push('lastEntityUpdate', 'entities');
    frames.push(Frame.define(into('dataset'), ...fields));
  }

  return unjoiner(...frames);
};

const _get = (exec, options) => {
  // actorId is the id of an actor whose entity access should be limited
  // according to ownerOnly.
  const { 'entities.creatorId': actorId, ...condition } = options.condition;
  const unjoin = _unjoin(options.datasetMetadata, actorId);
  return exec(sql`SELECT ${unjoin.fields} FROM form_attachments
    LEFT OUTER JOIN (SELECT id, md5 FROM blobs) AS blobs ON form_attachments."blobId"=blobs.id
    ${!options.datasetMetadata ? sql`` : sql`
      LEFT OUTER JOIN (
        SELECT
          id,
          "approvalRequired",
          -- This is not just whether the ownerOnly flag is set, but whether the
          -- flag should apply to the form attachment for the actor.
          ${actorId == null ? sql`FALSE` : sql`"ownerOnly"`} AS "ownerOnly"
          FROM datasets
      ) AS datasets ON datasets.id = form_attachments."datasetId"
      LEFT OUTER JOIN (
        SELECT datasets.id, MAX("loggedAt") AS "lastAudit" FROM audits
        JOIN datasets ON audits."acteeId" = datasets."acteeId"
        ${actorId == null ? sql`` : sql`
          -- We're always interested in dataset.update actions, even for
          -- ownerOnly datasets.
          WHERE NOT datasets."ownerOnly" OR audits.action = 'dataset.update'
        `}
        GROUP BY datasets.id
      ) AS audit_metadata ON audit_metadata.id = datasets.id
    `}
    ${actorId == null ? sql`` : sql`
      LEFT OUTER JOIN (
        SELECT
          datasets.id,
          GREATEST(MAX(entities."createdAt"), MAX(entities."updatedAt")) AS "lastEntityUpdate",
          COUNT(1) AS entities
        FROM entities
        JOIN datasets ON datasets.id = entities."datasetId"
        WHERE
          datasets."ownerOnly"
          AND entities."creatorId" = ${actorId}
          AND entities."deletedAt" IS NULL
        GROUP BY datasets.id
      ) AS entity_metadata ON entity_metadata.id = datasets.id
    `}
    WHERE ${sqlEquals(condition)}
    ORDER BY form_attachments.name ASC`)
    .then(map(unjoin));
};

const getAllByFormDefId = (formDefId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ formDefId }));

const getByFormDefIdAndName = (formDefId, name, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ formDefId, name }));

// This function decides on the OpenRosa hash (functionally equivalent to an http Etag)
// It uses the blob md5 directly if it exists.
// If the attachment is actually an entity list, it looks up the last modified time
// in the database, which is computed from the latest dataset/entity audit timestamp.
// It is dynamic because it can change when a dataset's data is updated.
const _chooseOpenRosaHash = (attachment) => {
  if (attachment.blobId) return attachment.with({ openRosaHash: attachment.aux.blob.md5 });

  if (attachment.datasetId) {
    const { dataset } = attachment.aux;
    const millis = [dataset.lastAudit, dataset.lastEntityUpdate]
      .filter(date => date != null)
      .map(date => date.getTime());
    const lastUpdate = millis.length !== 0
      ? new Date(Math.max(...millis)).toISOString()
      : '1970-01-01';
    return attachment.with({
      openRosaHash: md5sum(dataset.ownerOnly ? `${dataset.entities},${lastUpdate}` : lastUpdate),
      datasetType: dataset.approvalRequired ? 'approvalEntityList' : 'entityList',
      ownerOnly: dataset.ownerOnly
    });
  }

  return attachment.with({ openRosaHash: null });
};

const getAllByFormDefIdForOpenRosa = (formDefId, options = QueryOptions.none) => ({ FormAttachments }) =>
  FormAttachments.getAllByFormDefId(formDefId, options.with({ datasetMetadata: true }))
    .then((attachments) => attachments.map(_chooseOpenRosaHash));

const getByFormDefIdAndNameForOpenRosa = (formDefId, name, options = QueryOptions.none) => ({ FormAttachments }) =>
  FormAttachments.getByFormDefIdAndName(formDefId, name, options.with({ datasetMetadata: true }))
    .then(maybeAttachment => maybeAttachment.map(_chooseOpenRosaHash));


module.exports = {
  createNew, createVersion,
  update,
  getAllByFormDefId, getByFormDefIdAndName,
  getAllByFormDefIdForOpenRosa, getByFormDefIdAndNameForOpenRosa,
  _chooseOpenRosaHash
};

