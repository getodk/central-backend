// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');

const remove = (userId, acteeId, propertyName) => ({ maybeOne }) =>
  maybeOne(sql`
    DELETE FROM
      "user_preferences"
    WHERE
      ("userId", "acteeId", "propertyName")
      =
      (${userId}, ${acteeId}, ${propertyName})
    RETURNING
      1 AS "delcnt"
  `);


const put = (userId, acteeId, propertyName, propertyValue) => ({ one }) =>
  one(sql`
    INSERT INTO "user_preferences"
      ("userId", "acteeId", "propertyName", "propertyValue")
      VALUES
      (${userId}, ${acteeId}, ${propertyName}, ${propertyValue})
    ON CONFLICT ON CONSTRAINT "primary key"
      DO UPDATE
        SET "propertyValue" = ${propertyValue}
    RETURNING
      1 AS "modified_count"
  `);


const getForUser = (userId) => ({ maybeOne }) =>
  maybeOne(sql`
    WITH "props" AS (
        SELECT
            "acteeId",
            jsonb_object_agg("propertyName", "propertyValue") AS "acteeprops"
        FROM
            "user_preferences"
        WHERE
            "userId" = ${userId}
        GROUP BY
            "acteeId"
    )
    SELECT
        coalesce(jsonb_object_agg("acteeId", "acteeprops"), jsonb_build_object()) AS "preferences"
    FROM
        "props"
  `);


module.exports = { remove, put, getForUser };
