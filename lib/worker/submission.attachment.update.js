// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { blobContent } = require('../util/blob');
const { parseClientAudits } = require('../data/client-audits');

const worker = ({ s3, ClientAudits, Blobs, Submissions, SubmissionAttachments }, event) =>
  Promise.all([
    Submissions.getDefById(event.details.submissionDefId),
    SubmissionAttachments.getBySubmissionDefIdAndName(event.details.submissionDefId, event.details.name)
  ])
    .then(([ maybeSubmission, maybeAttachment ]) =>
      (maybeSubmission.map((s) => s.localKey != null).orElse(false)
        ? null
        : maybeAttachment.map((attachment) => (((attachment.blobId == null) || (attachment.isClientAudit !== true))
          ? null
          : ClientAudits.existsForBlob(attachment.blobId)
            .then((exists) => ((exists === true)
              ? null // do nothing
              : Blobs.getById(attachment.blobId)
                .then((maybeBlob) => maybeBlob.get())
                .then(blob => blobContent(s3, blob))
                .then(parseClientAudits)
                .then((audits) => {
                  const withBlobIds = audits.map((audit) => audit.with({ blobId: attachment.blobId }));
                  return ClientAudits.createMany(withBlobIds);
                })))))
          .orNull()));

module.exports = worker;

