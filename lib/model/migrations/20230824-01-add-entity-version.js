// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.query('ALTER TABLE entity_defs ADD COLUMN version INT4 NOT NULL DEFAULT 1');

  // Sets the correct version number for existing entities
  await db.query(`
  UPDATE entity_defs SET "version" = vt.rownumber
  FROM (
    SELECT ROW_NUMBER() OVER(PARTITION BY "entityId" ORDER BY id ) rownumber, id FROM entity_defs
  )
  vt WHERE vt.id = entity_defs.id
`);
};

const down = (db) => db.query('ALTER TABLE entity_defs DROP COLUMN version');

module.exports = { up, down };
