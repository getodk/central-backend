// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

module.exports = {
  existsForBlob: (blobId) => ({ db }) =>
    db.count('*').from('client_audits')
      .where({ blobId })
      .limit(1)
      .then(([{ count }]) => Number(count) > 0),

  streamForExport: (formId, draft) => ({ db }) =>
    db.select('client_audits.*', 'blobs.content')
      .from('submission_defs')
      .innerJoin(
        db.select(db.raw('max(id) as id'))
          .from('submission_defs')
          .groupBy('submissionId')
          .as('latest'),
        'submission_defs.id', 'latest.id'
      )
      .innerJoin(
        db.select('id').from('submissions').where({ formId, draft, deletedAt: null })
          .as('submissions'),
        'submissions.id', 'submission_defs.submissionId'
      )
      .innerJoin(
        db.select('submissionDefId', 'blobId')
          .from('submission_attachments')
          .where({ isClientAudit: true })
          .as('attachments'),
        'attachments.submissionDefId', 'submission_defs.id'
      )
      .leftOuterJoin('client_audits', 'client_audits.blobId', 'attachments.blobId')
      // knex is incapable of generating this snippet without a syntax error for some reason:
      .leftOuterJoin('blobs', db.raw('blobs.id = attachments."blobId" and client_audits."blobId" is null'))
      .orderBy('submission_defs.createdAt', 'asc')
      .orderBy('submission_defs.id', 'asc') // createdAt tends to tie in the tests.
      .stream()
};

