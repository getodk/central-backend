// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Submission Attachments are files that are expected to exist given the submission
// xml data and the form XForms xml definition.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Audit, Blob, Submission } = require('../frames');
const { odataFilter } = require('../../data/odata-filter');
const { odataToColumnMap } = require('../../data/submission');
const { submissionXmlToFieldStream } = require('../../data/submission');
const { insertMany, sqlInArray, QueryOptions } = require('../../util/db');
const { resolve } = require('../../util/promise');
const { isBlank, construct } = require('../../util/util');
const { traverseXml, findAll, root, node, text } = require('../../util/xml');
const { defaultMimetypeFor, streamBlobs } = require('../../util/blob');


////////////////////////////////////////////////////////////////////////////////
// IMPORTERS

const _makeAttachment = (ensure, submissionDefId, name, file = null, deprecated = null, index = null, isClientAudit = null) => {
  const data = { submissionDefId, name, index, isClientAudit, blobId: deprecated };
  return (file == null) ? resolve(new Submission.Attachment(data))
    : ensure(Blob.fromBuffer(file.buffer, file.mimetype || defaultMimetypeFor(name))).then((blobId) => {
      data.blobId = blobId;
      return new Submission.Attachment(data);
    });
};

const _extractAttachments = async (ensure, submission, binaryFields, fileLookup, deprecatedLookup) => {
  const results = [];
  const seen = new Set();

  for await (const obj of submissionXmlToFieldStream(binaryFields, submission.xml)) {
    if (obj.field.binary !== true) continue;
    const name = obj.text.trim();
    if (isBlank(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const isClientAudit = (obj.field.path === '/meta/audit');
    results.push(_makeAttachment(ensure, submission.def.id, name, fileLookup[name], deprecatedLookup[name], null, isClientAudit));
  }
  return Promise.all(results);
};

const _extractEncryptedAttachments = (ensure, submission, binaryFields, fileLookup, deprecatedLookup) =>
  traverseXml(submission.xml, [ findAll(root(), node('media'), node('file'))(text()) ])
    .then(([ maybeNames ]) => maybeNames.orElse([])) // if we found none at all return []
    .then((names) => {
      const results = [];
      let i = 0;
      for (; i < names.length; i += 1) {
        if (names[i].isDefined()) {
          const name = names[i].get().trim();
          const isClientAudit = (name === 'audit.csv.enc');
          results.push(_makeAttachment(ensure, submission.def.id, name, fileLookup[name], deprecatedLookup[name], i, isClientAudit));
        }
      }

      const encName = submission.def.encDataAttachmentName.trim();
      results.push(_makeAttachment(ensure, submission.def.id, encName, fileLookup[encName], deprecatedLookup[encName], i));
      return Promise.all(results);
    });

const create = (submission, form, binaryFields, files = [], deprecated = []) => ({ run, Blobs, context }) => {
  if ((submission.def.localKey == null) && (binaryFields.length === 0)) return resolve();

  // build our lookups and process the submission xml to find out what we expect:
  const fileLookup = {};
  for (const file of files) { fileLookup[file.fieldname] = file; }
  const deprecatedLookup = {};
  for (const att of deprecated) { deprecatedLookup[att.name] = att.blobId; }
  const f = (submission.def.localKey == null) ? _extractAttachments : _extractEncryptedAttachments;
  return f(Blobs.ensure, submission, binaryFields, fileLookup, deprecatedLookup).then((attachments) => {
    if (attachments.length === 0) return;

    // now formulate audit log entries for insertion:
    const logs = [];
    for (const attachment of attachments) {
      if (attachment.blobId != null) {
        logs.push(Audit.of(context.auth.actor, 'submission.attachment.update', form, {
          instanceId: submission.instanceId,
          submissionDefId: submission.def.id,
          name: attachment.name,
          newBlobId: attachment.blobId
        }));
      }
    }

    // and insert all attachments and logs:
    return Promise.all([ run(insertMany(attachments)), run(insertMany(logs)) ]);
  });
};

const upsert = (submission, form, def, files) => ({ run, Blobs, SubmissionAttachments, context }) =>
  SubmissionAttachments.getAllByDefId(def.id)
    .then((expecteds) => {
      const lookup = new Set(expecteds.map((att) => att.name));
      const present = files.filter((file) => lookup.has(file.fieldname));
      return Promise.all(
        present.map((file) => Blobs.ensure(Blob.fromBuffer(file.buffer, file.mimetype || defaultMimetypeFor(file.fieldname)))
          .then((blobId) => SubmissionAttachments.attach(def.id, file.fieldname, blobId))
        )
      ).then(linkResults =>
        // auditlog the updates (only those which were added or of which the content changed)
        linkResults
          .filter(el => el.blobNow && el.blobBefore !== el.blobNow)
          .map(linkResult =>
            Audit.of(
              context.auth.actor,
              'submission.attachment.update',
              form,
              {
                instanceId: submission.instanceId,
                submissionDefId: def.id,
                name: linkResult.name,
                newBlobId: linkResult.blobNow,
              }
            )
          )
      ).then(auditsInSpe => run(insertMany(auditsInSpe)));
    });

const attach = (defId, name, blobId) => ({ one }) => one(sql`
    WITH extant AS (
      SELECT "blobId"
      FROM submission_attachments
      WHERE "submissionDefId"=${defId} AND name=${name}
    ),
    attached AS (
      UPDATE submission_attachments SET "blobId"=${blobId}
      WHERE "submissionDefId"=${defId} AND name=${name} AND "blobId" IS DISTINCT FROM ${blobId}
      RETURNING "blobId"
    )
    SELECT ${name} as name, (SELECT "blobId" FROM extant) as "blobBefore", (SELECT "blobId" FROM attached) as "blobNow"
`);

const clear = (sa) => ({ run }) => run(sql`
update submission_attachments set "blobId"=null
where "submissionDefId"=${sa.submissionDefId} and name=${sa.name}`);

clear.audit = (sa, form, instanceId) => (log) => log('submission.attachment.update', form,
  { instanceId, submissionDefId: sa.submissionDefId, name: sa.name, oldBlobId: sa.blobId });


////////////////////////////////////////////////////////////////////////////////
// BASIC GETTERS
// because we are so so so nested at this point (project>form>submission>(version>)attachment)
// we have a lot of different specialized getters here.

////////////////////////////////////////
// logical submission getters

const _get = (formId, submissionId, name, draft) => sql`
select submission_attachments.* from submission_attachments
join submission_defs on current=true
  and submission_attachments."submissionDefId"=submission_defs.id
join submissions on submissions.id=${submissionId}
  and draft=${draft}
  and "formId"=${formId}
  and submissions.id=submission_defs."submissionId"
  and submissions."deletedAt" is null
${isBlank(name) ? sql`` : sql`where name=${name}`}
order by name asc`;

const getCurrentForSubmissionId = (formId, submissionId, draft) => ({ all }) =>
  all(_get(formId, submissionId, null, draft)).then(map(construct(Submission.Attachment)));

const getCurrentBlobByIds = (formId, submissionId, name, draft) => ({ maybeOne }) => maybeOne(sql`
with sa as (${_get(formId, submissionId, name, draft)})
select blobs.* from blobs, sa where blobs.id=sa."blobId"`)
  .then(map(construct(Blob)));

// logical submission getters
////////////////////////////////////////
// version submission getters

const _getVersion = (formId, instanceId, name, draft) => sql`
select submission_attachments.* from submission_attachments
join submission_defs on "instanceId"=${instanceId} and
  submission_defs.id=submission_attachments."submissionDefId"
join submissions on draft=${draft} and "formId"=${formId} and "deletedAt" is null and
  submissions.id=submission_defs."submissionId"
${isBlank(name) ? sql`` : sql`where name=${name}`}
order by name asc`;

const getForFormAndInstanceId = (formId, instanceId, draft) => ({ all }) =>
  all(_getVersion(formId, instanceId, null, draft)).then(map(construct(Submission.Attachment)));

const getBlobByFormAndInstanceId = (formId, instanceId, name, draft) => ({ maybeOne }) => maybeOne(sql`
with sa as (${_getVersion(formId, instanceId, name, draft)})
select blobs.* from blobs, sa where blobs.id=sa."blobId"`)
  .then(map(construct(Blob)));

// version submission getters
////////////////////////////////////////

const getAllByDefId = (submissionDefId) => ({ all }) =>
  all(sql`select * from submission_attachments where "submissionDefId"=${submissionDefId} order by name`)
    .then(map(construct(Submission.Attachment)));

const getBySubmissionDefIdAndName = (subDefId, name) => ({ maybeOne }) =>
  maybeOne(sql`select * from submission_attachments where "submissionDefId"=${subDefId} and name=${name}`)
    .then(map(construct(Submission.Attachment)));

const getByFormAndInstanceIdAndName = (formId, instanceId, name, draft) => ({ maybeOne }) =>
  maybeOne(_getVersion(formId, instanceId, name, draft))
    .then(map(construct(Submission.Attachment)));


////////////////////////////////////////////////////////////////////////////////
// EXPORT

const streamForExport = (formId, draft, keyIds, options = QueryOptions.none) => ({ s3, stream }) => stream(sql`
select submission_attachments.name, blobs.id AS "blobId", blobs.content, blobs.s3_status, blobs.sha, submission_attachments.index, form_defs."keyId", submissions."instanceId", submission_defs."localKey" from submission_defs
inner join (select * from submissions where draft=${draft}) as submissions
  on submissions.id=submission_defs."submissionId"
inner join form_defs on submission_defs."formDefId"=form_defs.id
inner join submission_attachments on submission_attachments."submissionDefId"=submission_defs.id
inner join blobs on blobs.id=submission_attachments."blobId"
where submission_defs.current=true
  and submissions."formId"=${formId}
  and "deletedAt" is null
  and ${odataFilter(options.filter, odataToColumnMap)}
  and submission_attachments.name is distinct from submission_defs."encDataAttachmentName"
  and submission_attachments."isClientAudit" is not true
  and (form_defs."keyId" is null or ${sqlInArray(sql`form_defs."keyId"`, keyIds)})`
)
  .then(dbStream => streamBlobs(s3, dbStream));

module.exports = {
  create, upsert, attach, clear,
  getCurrentForSubmissionId, getCurrentBlobByIds,
  getForFormAndInstanceId, getByFormAndInstanceIdAndName,
  getBlobByFormAndInstanceId,
  getAllByDefId, getBySubmissionDefIdAndName,
  streamForExport
};

