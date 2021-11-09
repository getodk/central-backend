// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { insertMany, QueryOptions } = require('../../util/db');
const { odataFilter } = require('../../data/odata-filter');


const createMany = (cas) => ({ run }) => run(insertMany(cas));

const existsForBlob = (blobId) => ({ maybeOne }) =>
  maybeOne(sql`select true from client_audits where "blobId"=${blobId} limit 1`)
    .then((x) => x.isDefined());

// TODO: copy-pasted from query/submission-attachments.js
const keyIdCondition = (keyIds) =>
  sql.join((((keyIds == null) || (keyIds.length === 0)) ? [ -1 ] : keyIds), sql`,`);

const streamForExport = (formId, draft, keyIds, options = QueryOptions.none) => ({ stream }) => stream(sql`
select client_audits.*, blobs.content, submissions."instanceId", "localKey", "keyId", index, submissions."instanceId" from submission_defs
  inner join
    (select id, "submitterId", "createdAt", "updatedAt", "instanceId", "reviewState" from submissions
      where "formId"=${formId} and draft=${draft} and "deletedAt" is null) as submissions
    on submissions.id=submission_defs."submissionId"
  inner join
    (select "submissionDefId", "blobId", index from submission_attachments
      where "isClientAudit"=true) as attachments
    on attachments."submissionDefId"=submission_defs.id
  left outer join client_audits on client_audits."blobId"=attachments."blobId"
  left outer join blobs on blobs.id=attachments."blobId" and client_audits."blobId" is null
  inner join form_defs on submission_defs."formDefId"=form_defs.id
  where ${odataFilter(options.filter)}
    and current=true
    and (form_defs."keyId" is null or form_defs."keyId" in (${keyIdCondition(keyIds)}))
  order by submission_defs."createdAt" asc, submission_defs.id asc`);

module.exports = { createMany, existsForBlob, streamForExport };

