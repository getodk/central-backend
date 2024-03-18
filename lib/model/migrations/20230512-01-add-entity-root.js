// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw('ALTER TABLE entity_defs ADD COLUMN "root" BOOLEAN NOT NULL DEFAULT FALSE');

  // This should be all of the entity_defs
  await db.raw(`UPDATE entity_defs SET root = TRUE
  WHERE id IN (SELECT MIN(id) FROM entity_defs GROUP BY "entityId")`);
};

const down = (db) => db.raw('ALTER TABLE entity_defs DROP COLUMN "root"');

module.exports = { up, down };
