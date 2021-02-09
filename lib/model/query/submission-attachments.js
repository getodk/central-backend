// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
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
const { submissionXmlToFieldStream } = require('../../data/submission');
const { insertMany, QueryOptions } = require('../../util/db');
const { resolve } = require('../../util/promise');
const { isBlank, construct } = require('../../util/util');
const { traverseXml, findAll, root, node, text } = require('../../util/xml');
const Option = require('../../util/option');


////////////////////////////////////////////////////////////////////////////////
// IMPORTERS

const _makeAttachment = (submissionDefId, name, file = null, index = null, isClientAudit = null) =>
  ((file == null) ? resolve(null) : Blob.fromFile(file.path, file.mimetype)).then((blob) =>
    new Submission.Attachment({ submissionDefId, name, index, isClientAudit }, { blob: Option.of(blob) }));

const _extractAttachments = async (submission, binaryFields, fileLookup) => {
  const results = [];

  for await (const obj of submissionXmlToFieldStream(binaryFields, submission.xml)) {
    if (obj.field.binary !== true) continue;
    const name = obj.text.trim();
    if (isBlank(name)) continue;
    const isClientAudit = (obj.field.path === '/meta/audit');
    results.push(_makeAttachment(submission.def.id, name, fileLookup[name], null, isClientAudit));
  }
  return Promise.all(results);
};

const _extractEncryptedAttachments = (submission, binaryFields, fileLookup) =>
  traverseXml(submission.xml, [ findAll(root(), node('media'), node('file'))(text()) ])
    .then(([ maybeNames ]) => maybeNames.orElse([])) // if we found none at all return []
    .then((names) => {
      const results = [];
      let i = 0;
      for (; i < names.length; i += 1) {
        if (names[i].isDefined()) {
          const name = names[i].get().trim();
          results.push(_makeAttachment(submission.def.id, name, fileLookup[name], i));
        }
      }

      const encName = submission.def.encDataAttachmentName.trim();
      results.push(_makeAttachment(submission.def.id, encName, fileLookup[encName], i));
      return Promise.all(results);
    });

const create = (submission, form, binaryFields, files = []) => async ({ run, Blobs, context }) => {
  //if (binaryFields.length === 0) return resolve(); // TODO/SL it feels like we can do this??
  const { def } = submission;

  // build our lookup and process the submission xml to find out what we expect:
  const fileLookup = {};
  for (const file of files) { fileLookup[file.fieldname] = file; }
  const f = (def.localKey == null) ? _extractAttachments : _extractEncryptedAttachments;
  const attachments = await f(submission, binaryFields, fileLookup);
  if (attachments.length === 0) return resolve();

  // then insert all our blobs in parallel:
  const blobIds = {};
  for (const attachment of attachments)
    attachment.aux.blob.ifDefined((blob) => { blobIds[attachment.name] = Blobs.ensure(blob); });

  // now update all our attachments with their blobIds where relevant, and formulate
  // audit log entries for insertion:
  const withBlobIds = new Array(attachments.length);
  const logs = [];
  for (let i = 0; i < withBlobIds.length; i += 1) {
    const attachment = attachments[i];
    const blobId = await blobIds[attachment.name]; // eslint-disable-line no-await-in-loop
    const hasBlob = blobId != null;
    withBlobIds[i] = hasBlob ? attachment.with({ blobId }) : attachment;
    if (hasBlob) {
      logs.push(Audit.of(context.auth.actor, 'submission.attachment.update', form, {
        instanceId: submission.instanceId,
        submissionDefId: def.id,
        name: attachment.name,
        newBlobId: attachment.blobId
      }));
    }
  }

  // and insert all attachments and logs:
  return Promise.all([ run(insertMany(withBlobIds)), run(insertMany(logs)) ]);
};

const upsert = (def, files) => ({ Blobs, SubmissionAttachments }) =>
  SubmissionAttachments.getAllByDefId(def.id)
    .then((expecteds) => {
      const lookup = new Set(expecteds.map((att) => att.name));
      const present = files.filter((file) => lookup.has(file.fieldname));
      return Promise.all(present
        .map((file) => Blob.fromFile(file.path, file.mimetype)
          .then(Blobs.ensure)
          .then((blobId) => SubmissionAttachments.attach(def, file.fieldname, blobId))));
    });

const attach = (def, name, blobId) => ({ run }) => run(sql`
update submission_attachments set "blobId"=${blobId}
where "submissionDefId"=${def.id} and name=${name}`);

const clear = (sa) => ({ run }) => run(sql`
update submission_attachments set "blobId"=null
where "submissionDefId"=${sa.submissionDefId} and name=${sa.name}`);

clear.audit = (sa, form, instanceId) => (log) => log('submission.attachment.update', form,
  { instanceId, submissionDefId: sa.submissionDefId, name: sa.name, oldBlobId: sa.blobId });


////////////////////////////////////////////////////////////////////////////////
// BASIC GETTERS

const getAllByDefId = (submissionDefId) => ({ all }) =>
  all(sql`select * from submission_attachments where "submissionDefId"=${submissionDefId} order by name`)
    .then(map(construct(Submission.Attachment)));

const getBySubmissionDefIdAndName = (subDefId, name) => ({ maybeOne }) =>
  maybeOne(sql`select * from submission_attachments where "submissionDefId"=${subDefId} and name=${name}`)
    .then(map(construct(Submission.Attachment)));

const getExpectedNamesByDefId = (id) => ({ first }) =>
  first(sql`select name from submission_attachments where "submissionDefId"=${id} order by name`);


////////////////////////////////////////////////////////////////////////////////
// EXPORT

const keyIdCondition = (keyIds) =>
  sql.join((((keyIds == null) || (keyIds.length === 0)) ? [ -1 ] : keyIds), sql`,`);

const streamForExport = (formId, draft, keyIds, options = QueryOptions.none) => ({ stream }) => stream(sql`
select submission_attachments.name, blobs.content, submission_attachments.index, form_defs."keyId", submissions."instanceId", submission_defs."localKey" from submission_defs
inner join (select * from submissions where draft=${draft}) as submissions
  on submissions.id=submission_defs."submissionId"
inner join form_defs on submission_defs."formDefId"=form_defs.id
inner join submission_attachments on submission_attachments."submissionDefId"=submission_defs.id
inner join blobs on blobs.id=submission_attachments."blobId"
where submission_defs.current=true
  and submissions."formId"=${formId}
  and "deletedAt" is null and ${odataFilter(options.filter)}
  and submission_attachments.name is distinct from submission_defs."encDataAttachmentName"
  and (form_defs."keyId" is null or form_defs."keyId" in (${keyIdCondition(keyIds)}))`);

module.exports = {
  create, upsert, attach, clear,
  getAllByDefId, getBySubmissionDefIdAndName, getExpectedNamesByDefId,
  streamForExport
};

