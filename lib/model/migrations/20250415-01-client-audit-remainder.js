// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`
    ALTER TABLE client_audits
      ADD COLUMN "user" TEXT,
      ADD COLUMN "change-reason" TEXT
  `);

  await db.raw(`
    UPDATE client_audits
    SET 
      "user" = remainder->>'user',
      "change-reason" = remainder->>'change-reason'
    WHERE remainder IS NOT NULL;
  `);
};

const down = async (db) => {
  await db.raw(`
    ALTER TABLE client_audits
      DROP COLUMN "user",
      DROP COLUMN "change-reason"
  `);
};

module.exports = { up, down };
