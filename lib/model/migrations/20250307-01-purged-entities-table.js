// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.query(`
    CREATE TABLE purged_entities (
      "entityUuid" varchar NOT NULL,
      "acteeId" varchar NOT NULL,
      "auditId" serial4 NOT NULL,
      CONSTRAINT purged_entities_pkey PRIMARY KEY ("entityUuid")
    );`);
  await db.query(`CREATE INDEX purged_entities_actee_uuid_index ON purged_entities ("acteeId", "entityUuid");`);
};

const down = async (db) => {
  await db.query(`DROP TABLE purged_entities`);
};

module.exports = { up, down };
