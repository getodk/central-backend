// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`CREATE TYPE "conflictType" AS ENUM ('soft', 'hard')`);

  await db.raw('ALTER TABLE entities ADD COLUMN conflict "conflictType" NULL');

  await db.raw(`ALTER TABLE entity_defs 
    ADD COLUMN "dataReceived" JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- null means, it's a first version
    ADD COLUMN "baseVersion" INT4,  

    -- array of conflicting properties
    ADD COLUMN "conflictingProperties" JSONB NULL 

    -- Not adding explicit 'conflict' column: version created conflict if "baseVersion" < "version" - 1
  `);

  // Sets the value for "dataReceived" and "baseVersion" for existing row
  await db.raw(`UPDATE entity_defs SET "dataReceived" = data || jsonb_build_object('label', "label"), "baseVersion" = CASE WHEN version > 1 THEN version - 1 ELSE NULL END`);

};

const down = async (db) => {
  await db.raw('ALTER TABLE entities DROP COLUMN conflict');
  await db.raw('ALTER TABLE entity_defs DROP COLUMN "dataReceived", DROP COLUMN "baseVersion"');
};

module.exports = { up, down };
