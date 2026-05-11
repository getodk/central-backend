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
ADD COLUMN "creatorId" integer,
ADD COLUMN "userAgent" varchar(255)
`);

  // Assign root entity creator id (same as submitter id) to entity def creator id
  await db.raw(`
UPDATE entity_defs
SET "creatorId" = entities."creatorId"
FROM entities
WHERE entity_defs."entityId" = entities.id;
  `);

  // Assign submission user agent to entity def
  await db.raw(`
UPDATE entity_defs
SET "userAgent" = submission_defs."userAgent"
FROM submission_defs
WHERE entity_defs."submissionDefId" = submission_defs.id;
  `);

  // alter table to make new column not null
  await db.raw(`
ALTER TABLE entity_defs
ALTER COLUMN "creatorId" SET NOT NULL
`);
};

const down = (db) => db.raw(`
ALTER TABLE entity_defs
DROP COLUMN "creatorId",
DROP COLUMN "userAgent"
`);

module.exports = { up, down };

