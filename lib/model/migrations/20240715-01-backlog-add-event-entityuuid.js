// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.query(`ALTER TABLE entity_submission_backlog
    ADD COLUMN "auditId" INT4 NOT NULL,
    ADD COLUMN "entityUuid" UUID NOT NULL,
    ADD CONSTRAINT fk_audit_id
      FOREIGN KEY("auditId")
      REFERENCES audits(id)
      ON DELETE CASCADE`);
};

const down = (db) => db.query(`ALTER TABLE entity_submission_backlog
  DROP COLUMN "auditId",
  DROP COLUMN "entityUuid"
`);

module.exports = { up, down };
