// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// From earlier form-purging, there could have been leftover client audits
// that were not properly purged because of how they joined to submissions.
// This migration deletes those client audit rows, allowing the blobs to finally
// be de-referenced and also eventually purged (by the puring cron job).

const up = (db) => db.raw(`
DELETE FROM client_audits
WHERE "blobId" NOT IN (
  SELECT "blobId" FROM submission_attachments
  WHERE "blobId" IS NOT NULL
  AND "isClientAudit" IS true
);
`);

const down = () => {};

module.exports = { up, down };

