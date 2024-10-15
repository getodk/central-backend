// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');


const getForUser = (userId) => ({ one }) =>
  one(sql`
    SELECT
        (
            SELECT
                jsonb_build_object(
                    'projects',
                    coalesce(
                        jsonb_object_agg(
                            projprops."projectId",
                            projprops.props
                        ),
                        jsonb_build_object()
                    )
                )
            FROM
                (
                    SELECT
                        "projectId",
                        jsonb_object_agg("propertyName", "propertyValue") AS props
                    FROM
                        user_project_preferences
                    WHERE
                        "userId" = ${userId}
                    GROUP BY
                        "projectId"
                ) AS projprops
        )
        ||
        (
            SELECT
                jsonb_build_object(
                    'site',
                    coalesce(
                        jsonb_object_agg(
                            user_site_preferences."propertyName",
                            user_site_preferences."propertyValue"
                        ),
                        jsonb_build_object()
                    )
                )
            FROM
                user_site_preferences
            WHERE
                "userId" = ${userId}
        )
    AS preferences
  `);


const _writeProperty = (tablename, subject, userId, propertyName, propertyValue) => ({ one }) => {
  const targetColumns = ['userId', 'propertyName', 'propertyValue']
    .concat((subject === null) ? [] : ['projectId'])
    .map(el => sql.identifier([el]));

  // Work around null confusion (potential Slonik bug?).
  // sql.json(null) doesn't produce what we need, it results in an exception
  // "Error: Required parameter propertyValue missing."
  // Yet the string 'null' (as distinct from the *jsonb* string '"null"' one would get with sql.json('null') !)
  // gets properly casted by PostgreSQL to a jsonb null (as distinct from an SQL NULL), so we use that in this case.
  const preparedPropertyValue = (propertyValue === null) ? 'null': sql.json(propertyValue);
  const values = [userId, propertyName, preparedPropertyValue]
    .concat((subject === null) ? [] : [subject]);

  return one(sql`
    INSERT INTO ${sql.identifier([tablename])}
      (${sql.join(targetColumns, `, `)})
    VALUES
      (${sql.join(values, `, `)})
    ON CONFLICT ON CONSTRAINT ${sql.identifier([`${tablename}_primary_key`])}
      DO UPDATE
        SET "propertyValue" = ${preparedPropertyValue}
    RETURNING
      1 AS "modified_count"
  `);
};


const _removeProperty = (tablename, subject, userId, propertyName) => ({ maybeOne }) => {
  const targetColumns = ['userId', 'propertyName']
    .concat((subject === null) ? [] : ['projectId'])
    .map(el => sql.identifier([el]));

  const values = [userId, propertyName]
    .concat((subject === null) ? [] : [subject]);

  return maybeOne(sql`
    DELETE FROM ${sql.identifier([tablename])}
    WHERE
      (${sql.join(targetColumns, `, `)})
      =
      (${sql.join(values, `, `)})
    RETURNING
      1 AS "deleted_count"
  `);
};


const writeSiteProperty = (userId, propertyName, propertyValue) => ({ one }) =>
  _writeProperty('user_site_preferences', null, userId, propertyName, propertyValue)({ one });

const removeSiteProperty = (userId, propertyName) => ({ maybeOne }) =>
  _removeProperty('user_site_preferences', null, userId, propertyName)({ maybeOne });

const writeProjectProperty = (userId, projectId, propertyName, propertyValue) => ({ one }) =>
  _writeProperty('user_project_preferences', projectId, userId, propertyName, propertyValue)({ one });

const removeProjectProperty = (userId, projectId, propertyName) => ({ maybeOne }) =>
  _removeProperty('user_project_preferences', projectId, userId, propertyName)({ maybeOne });

module.exports = { removeSiteProperty, writeSiteProperty, writeProjectProperty, removeProjectProperty, getForUser };
