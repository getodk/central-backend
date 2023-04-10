// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // Add columns
  await db.raw(`
  ALTER TABLE entity_defs
  ADD COLUMN "label" text
  `);

  // Assign label from root entity to entity def
  // should only be one entity def per entity at the time
  // of this migration.
  await db.raw(`
  UPDATE entity_defs
  set "label" = entities."label"
  FROM entities
  WHERE entity_defs."entityId" = entities.id;
  `);

  // set label to not null
  await db.raw(`
  ALTER TABLE entity_defs
  ALTER COLUMN "label" SET NOT NULL
  `);

  await db.raw(`
  ALTER TABLE entities
  DROP COLUMN "label",
  ADD COLUMN "deletedAt" timestamp
  `);
};

const down = async (db) => {
  await db.raw(`
  ALTER TABLE entities
  ADD COLUMN "label" text
  `);

  await db.raw(`
  UPDATE entities
  set "label" = entity_defs."label"
  FROM entity_defs
  WHERE entity_defs."entityId" = entities.id;
    `);

  await db.raw(`
  ALTER TABLE entity_defs
  DROP COLUMN "label"
  `);

  await db.raw(`
  ALTER TABLE entities
  DROP COLUMN "deletedAt",
  ALTER COLUMN "label" SET NOT NULL
  `);
};

module.exports = { up, down };

