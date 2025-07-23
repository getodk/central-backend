// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');


const bigIntArrayToSql = (bigIntArray) =>
  // Workaround for Slonik not supporting bigint arrays, or rather, not supporting
  // BigInt inputs (throws `InvalidInputError: Invalid array member type. Must be a primitive value expression.`).
  // Furthermore, https://github.com/gajus/slonik/tree/v23.6.2?tab=readme-ov-file#manually-constructing-the-query:
  // "Manually constructing the query is not allowed". In absence of a raw sql fragment injection escape hatch,
  // we send the bigints in as a text[] which we let PostgreSQL convert into a bigint[].
  sql`ARRAY[${sql.array(bigIntArray.map(el => el.toString()), 'text')}]::int8[]`;


const getFeatureCollectionGeoJson = (formPK, fieldIds, submitterIds, createdAtStart, createdAtStop, reviewStates) => ({ db }) => {

  const formFieldFilter = (fieldIds.length ? sql`AND feg.fieldhash = ANY (${bigIntArrayToSql(fieldIds)})` : sql`AND ffge.is_default`);
  const submitterFilter = (submitterIds.length ? sql`AND sdef."submitterId" = ANY(${bigIntArrayToSql(submitterIds)})` : sql``);
  const createdAtStartFilter = (createdAtStart ? sql`AND sdef."createdAt" > ${createdAtStart}` : sql``);
  const createdAtStopFilter = (createdAtStop ? sql`AND sdef."createdAt" < ${createdAtStop}` : sql``);
  const reviewStateFilter = (reviewStates.length ? sql`AND sub."reviewState" = ANY (${sql.array(reviewStates, 'text')})` : sql``);

  return db.oneFirst(sql`
    WITH agged AS (
        SELECT
            feg.submission_def_id,
            sdef."instanceId",
            sdef."createdAt",
            actors.id AS "submitterId",
            actors."displayName" AS "submitterDisplayName",
            ST_Collect (
                -- per PostGIS docs, for full geojson conformance, the starting point of a polygon is not arbitrary.
                -- See https://postgis.net/docs/manual-3.5/ST_AsGeoJSON.html
                ST_ForcePolygonCCW(geovalue::geometry)
            ) AS geocollection
        FROM
            field_extract_geo feg
            INNER JOIN submission_defs sdef ON (
              feg.submission_def_id = sdef.id
              ${submitterFilter}
              ${createdAtStartFilter}
              ${createdAtStopFilter}
            )
            INNER JOIN submissions sub ON (
                sdef."submissionId" = sub.id
                AND
                sub."deletedAt" IS NULL
                ${reviewStateFilter}
            )
            INNER JOIN form_defs fdef ON (
                sdef."formDefId" = fdef.id
                AND
                fdef."formId" = ${formPK}
            )
            INNER JOIN form_field_geo_extractor ffge ON (
                feg.geovalue IS NOT NULL
                AND
                ffge.is_enabled
                AND
                (ffge.formschema_id, ffge.fieldhash) = (fdef."schemaId", feg.fieldhash)
                ${formFieldFilter}
            )
            INNER JOIN actors ON (
                sdef."submitterId" = actors.id
            )
            GROUP BY
                feg.submission_def_id,
                sdef."instanceId",
                sdef."createdAt",
                actors.id,
                "submitterDisplayName"
    )
    SELECT
        json_build_object(
            'type', 'FeatureCollection',
            'features', coalesce(
                json_agg(
                    (ST_AsGeoJSON(
                        agged.*,
                        geom_column => 'geocollection',
                        id_column => 'submission_def_id'
                    ))::json
                ),
                json_build_array()
            )
        )
    FROM
        agged
  `);
};

module.exports = {
  getFeatureCollectionGeoJson,
};
