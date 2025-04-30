// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const Option = require('../../util/option');

const getForUser = (userId) => ({ oneFirst }) =>
  oneFirst(sql`
    SELECT JSONB_BUILD_OBJECT(
      'site', COALESCE((
        SELECT JSONB_OBJECT_AGG("propertyName", "propertyValue")
          FROM user_site_preferences
          WHERE "userId" = ${userId}
      ), '{}'),
      'projects', COALESCE((
        SELECT JSONB_OBJECT_AGG("projectId", proj)
          FROM (
            SELECT "projectId"
                 , JSONB_OBJECT_AGG("propertyName", "propertyValue") AS proj
              FROM user_project_preferences
              WHERE "userId" = ${userId}
              GROUP BY "projectId"
          ) AS _
      ), '{}')
    )
  `);

const writeSiteProperty = (userId, propertyName, propertyValue) => ({ run }) => run(sql`
  INSERT INTO user_site_preferences ("userId", "propertyName", "propertyValue")
    VALUES(${userId}, ${propertyName}, ${JSON.stringify(propertyValue)})
    ON CONFLICT("userId", "propertyName") DO
      UPDATE SET "propertyValue"=EXCLUDED."propertyValue"
`);

const writeProjectProperty = (userId, projectId, propertyName, propertyValue) => ({ run }) => run(sql`
  INSERT INTO user_project_preferences ("userId", "projectId", "propertyName", "propertyValue")
    VALUES(${userId}, ${projectId}, ${propertyName}, ${JSON.stringify(propertyValue)})
    ON CONFLICT("userId", "projectId", "propertyName") DO
      UPDATE SET "propertyValue"=EXCLUDED."propertyValue"
`);

const removeSiteProperty = (userId, propertyName) => ({ db }) => db.query(sql`
  DELETE FROM user_site_preferences
    WHERE "userId" = ${userId}
      AND "propertyName" = ${propertyName}
`).then(({ rowCount }) => Option.of(rowCount || null));

const removeProjectProperty = (userId, projectId, propertyName) => async ({ db }) => db.query(sql`
  DELETE FROM user_project_preferences
    WHERE "userId" = ${userId}
      AND "propertyName" = ${propertyName}
      AND "projectId" = ${projectId}
`).then(({ rowCount }) => Option.of(rowCount || null));

module.exports = { removeSiteProperty, writeSiteProperty, writeProjectProperty, removeProjectProperty, getForUser };
