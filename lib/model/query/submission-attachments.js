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

const { map } = require('ramda');
const { SubmissionAttachment } = require('../frames');
const { insert, QueryOptions } = require('../../util/db');
const { odataFilter } = require('../../data/odata-filter');

const getAllBySubmissionDefId = (submissionDefId) => ({ all }) =>
  all(sql`select * from submission_attachments where "submissionDefId"=${submissionDefId} order by name`)
    .then(map(SubmissionAttachment.construct));

const createAll = (attachments) => ({ one }) => one(insert(attachment));

const update = (sa) => ({ run }) => run(sql`
update submission_attachments set "blobId"=sa."blobId"
where "submissionDefId"=${sa.submissionDefId} and name=${sa.name}`);

const streamForExport = (formId, draft, keyIds = [], options = QueryOptions.none) => ({ stream }) => stream(sql`
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
  and (form_defs."keyId" is null or form_defs."keyId" in (${sql.join(keyIds, sql`,`)}))`);

module.exports = { getAllBySubmissionDefId, createAll, update, streamForExport };

