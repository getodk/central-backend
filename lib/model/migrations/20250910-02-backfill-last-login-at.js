// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
const up = (db) =>
  db.raw(`
    UPDATE users 
    SET "lastLoginAt" = latest_login."loggedAt"
    FROM (
      SELECT 
        "actorId",
        MAX("loggedAt") as "loggedAt"
      FROM audits 
      WHERE action = 'user.session.create' 
        AND "actorId" IS NOT NULL
      GROUP BY "actorId"
    ) AS latest_login
    JOIN actors ON actors.id = latest_login."actorId"
    WHERE users."actorId" = latest_login."actorId"
      AND actors."deletedAt" IS NULL;
  `);

const down = (db) =>
  db.raw(`UPDATE users SET "lastLoginAt" = NULL;`);

module.exports = { up, down };
