// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`CREATE TABLE entity_submission_backlog (
    "submissionId" INT4 NOT NULL,
    "submissionDefId" INT4 NOT NULL,
    "branchId" UUID NOT NULL,
    "branchBaseVersion" INT4 NOT NULL,
    "loggedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT fk_submission_defs
      FOREIGN KEY("submissionDefId") 
      REFERENCES submission_defs(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_submissions
      FOREIGN KEY("submissionId") 
      REFERENCES submissions(id)
      ON DELETE CASCADE,
    UNIQUE ("branchId", "branchBaseVersion")
  )`);
};

const down = (db) => db.raw('DROP TABLE entity_submission_backlog');

module.exports = { up, down };
