// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Temporary migration - to be DELETED
const up = async (db) => {
  await db.raw(`
    ALTER TABLE entities
    ADD COLUMN "deletedAt" timestamptz(3) NULL;
`);

  await db.raw(`
    ALTER TABLE entity_defs
    ADD COLUMN "userAgent" text NULL,
    ADD COLUMN "creatorId" int4 NULL,
    ADD COLUMN "label" text NULL
  `);
};

const down = () => {

};

module.exports = { up, down };

