// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { parseClientAudits } = require('../data/client-audits');

const worker = ({ simply, ClientAudit, Blob, SubmissionAttachment }, event) =>
  SubmissionAttachment.getBySubmissionDefIdAndName(event.details.submissionDefId, event.details.name)
    .then((maybeAttachment) => maybeAttachment
      .map((attachment) => (((attachment.blobId == null) || (attachment.isClientAudit !== true))
        ? null
        : ClientAudit.existsForBlob(attachment.blobId)
          .then((exists) => ((exists === true)
            ? null // do nothing
            : Blob.getById(attachment.blobId)
              .then((maybeBlob) => maybeBlob.get()) // blobs are immutable
              .then((blob) => parseClientAudits(blob.content))
              .then((audits) => {
                for (const audit of audits) audit.blobId = attachment.blobId;
                return simply.insert('client_audits', audits);
              })))))
      .orNull());

module.exports = worker;

