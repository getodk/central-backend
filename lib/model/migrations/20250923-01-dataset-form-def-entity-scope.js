// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Augment dataset_form_defs with two new columns
// 1. path (where the root of the entity container is)
//      will be used to look up
//      path + ./meta/entity and path + ./meta/entity/label
// 2. isRepeat
//      Whether or not this field is a repeat in the form

const up = async (db) => {
  await db.raw(`
    ALTER TABLE dataset_form_defs
      ADD COLUMN "path" text NOT NULL DEFAULT '/',
      ADD COLUMN "isRepeat" boolean NOT NULL DEFAULT false;
  `);
};

const down = async (db) => {
  await db.raw(`
    ALTER TABLE dataset_form_defs
      DROP COLUMN "path",
      DROP COLUMN "isRepeat"
  `);
};

module.exports = { up, down };
