// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

module.exports = {
  checkExisting: (sha) => ({ db }) =>
    db.select(db.raw('blobs.id as "blobId", bool_or("isClientAudit") as "parsedAudits"'))
      .from('blobs')
      .where({ sha })
      .leftOuterJoin('submission_attachments', 'submission_attachments.blobId', 'blobs.id')
      .groupBy('blobs.id'),

  streamForExport: (formId) => ({ db }) =>
    db.select('client_audits.*')
      .from('submission_defs')
      .where({ 'submissions.formId': formId, deletedAt: null })
      .innerJoin(
        db.select(db.raw('max(id) as id'))
          .from('submission_defs')
          .groupBy('submissionId')
          .as('latest'),
        'submission_defs.id', 'latest.id'
      )
      .innerJoin('submissions', 'submissions.id', 'submission_defs.submissionId')
      .innerJoin(
        db.select('submissionDefId', 'blobId')
          .from('submission_attachments')
          .where({ isClientAudit: true })
          .as('attachments'),
        'attachments.submissionDefId', 'submission_defs.id'
      )
      .innerJoin('client_audits', 'client_audits.blobId', 'attachments.blobId')
      .orderBy('client_audits.start')
      .stream()
};

