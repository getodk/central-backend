// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Frame, table, into } = require('../frame');
const { SubmissionDef } = require('../frames');
const { unjoiner, page, QueryOptions } = require('../../util/db');
const { applyODataFilter } = require('../../data/odata-filter');


const getCurrentBySubmissionId = (submissionId) => ({ maybeOne }) => maybeOne(sql`
select * from submission_defs where "submissionId"=${submissionId}
order by "createdAt" desc limit 1`)
  .then(map(SubmissionDef.construct));

const getCurrentByIds = (projectId, xmlFormId, instanceId, draft) => ({ maybeOne }) => maybeOne(sql`
select submission_defs.* from submission_defs
inner join
  (select submissions.id from submissions
    inner join
      (select id from forms
        where "projectId"=${projectId} and "xmlFormId"=${xmlFormId} and "deletedAt" is null) as forms
      on forms.id=submissions."formId"
    where "instanceId"=${instanceId} and submissions."deletedAt" is null and draft=${draft}) as submissions
  on submissions.id=submission_defs."submissionId"
order by "createdAt" desc
limit 1`)
  .then(map(SubmissionDef.construct));


const _exportUnjoiner = unjoiner(Submission, SubmissionDef, SubmissionDef.Xml, Actor.to('submitter'),
  Frame.define(into('encryption'), 'encHasData'), Frame.define(table('attachments'), 'present', 'expected'));
const _export = (formId, draft, keyIds = [], options) => {
  const enc = (keyIds.length === 0) ? sql`` : null;
  return sql`
select ${_exportUnjoiner.fields} from (
select *,
  (case when submission_defs."localKey" is null then submission_defs.xml end) as xml,
  (submission_attachments."blobId" is not null) as "encHasData"
from submission_defs
inner join (select * from submissions where draft=${draft}) as submissions
  on submissions.id=submission_defs."submissionId"
left outer join actors on submissions."submitterId"=actors.id
left outer join submission_attachments
  on submission_attachments."submissionDefId"=submission_defs.id
  and submission_attachments.name=submission_defs."encDataAttachmentName"
left outer join
  (select "submissionDefId", count("blobId")::integer as present, count(name)::integer as expected
    from submission_attachments
    group by "submissionDefId") as attachments
  on attachments."submissionDefId"=submission_defs.id
${enc|| sql`
left outer join form_defs on form_defs.id=submission_defs."formDefId"
left outer join blobs on blobs.id=submission_attachments."blobId"`}
where
  ${enc|| sql`(form_defs."keyId" is null or form_defs."keyId" in (${sql.join(keyIds, sql`,`)})) and`}
  ${odataFilter(options.filter)}
  and submission_defs.current=true and submission."formId"=${formId} and submissions."deletedAt" is null
order by submissions."createdAt" desc, submissions.id desc
${page(options)})`;

const streamForExport = (formId, draft, keyIds, options = QueryOptions.none) => ({ stream }) =>
  stream(_export(formId, draft, keyIds, options))
    .then(stream.map(_exportUnjoiner));

const getForExport = (formId, instanceId, draft, options = QueryOptions.none) => ({ maybeOne }) =>
  maybeOne(_export(formId, draft, [], options.withCondition({ 'submissions."instanceId"': instanceId })))
    .then(map(_exportUnjoiner));

module.exports = { getCurrentBySubmissionId, getCurrentByIds, streamForExport, getForExport };

