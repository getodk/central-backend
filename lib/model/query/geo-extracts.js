// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');


const getSubmissionFeatureCollectionGeoJson = (formPK, fieldPaths, submitterIds, TSTZRange, reviewStates, deleted, limit) => ({ db }) => {

  const formFieldFilter = fieldPaths.length ? sql`AND ffgeo.path = ANY (${sql.array(fieldPaths, 'text')})` : sql`AND ffgeo.is_default`;
  const doPathInProperties = fieldPaths.length ? sql`, 'properties', NULL` : sql`, 'properties', json_build_object('fieldpath', path)`;
  const doAggregateByPath = fieldPaths.length ? sql`` : sql`, path`;
  const submitterFilter = submitterIds.length ? sql`AND sdef."submitterId" = ANY(${sql.array(submitterIds, 'int4')})` : sql``;
  const TSTZRangeFilter = TSTZRange ? sql`AND sdef."createdAt" <@ tstzrange(${TSTZRange[0]}, ${TSTZRange[1]}, ${TSTZRange[2]})` : sql``;
  const reviewStateFilter = reviewStates.length ? (reviewStates.includes(null) ? sql`AND sub."reviewState" IS NULL` : sql`AND sub."reviewState" = ANY (${sql.array(reviewStates, 'text')})`) : sql``;
  const deletedFilter = deleted ? sql`IS NOT` : sql`IS`;
  const queryLimit = limit ? sql`LIMIT ${limit}` : sql``;

  return db.oneFirst(sql`
        -- all targeted submission fields, with info on whether the geojson-value is cached
        WITH geo_needed AS (
            SELECT
                sxg.submission_def_id IS NOT NULL as is_cached,
                sdef.id as submission_def_id,
                sdef."instanceId",
                ffgeo.type,
                ffgeo.fieldhash,
                ffgeo.repeatgroup_cardinality,
                ffgeo.path,
                sxg.geovalue,
                sdef.xml as submission_xml
            FROM
                form_defs fdef
                INNER JOIN submission_defs sdef ON (
                    fdef."formId" = ${formPK}
                    AND
                    sdef."formDefId" = fdef.id
                    ${submitterFilter}
                    ${TSTZRangeFilter}
                )
                INNER JOIN submissions sub ON (
                    sdef."submissionId" = sub.id
                    AND
                    sub."deletedAt" ${deletedFilter} NULL
                    ${reviewStateFilter}
                )
                INNER JOIN form_field_geo ffgeo ON (
                    ffgeo.formschema_id = fdef."schemaId"
                    ${formFieldFilter}
                )
                -- determine whether cached or uncached through a left join
                LEFT OUTER JOIN submission_field_extract_geo_cache sxg ON (
                    sxg.submission_def_id = sdef.id
                    AND
                    ffgeo.fieldhash = sxg.fieldhash
                )
        ),
        -- the newly extracted geojson, in case we hadn't cached them before
        geojsoned AS (
            SELECT
                -- 1. needed for aggregates later
                "instanceId",
                path,
                -- 1. end
                -- 2. to be inserted in the cache table
                submission_def_id,
                fieldhash,
                extract_submission_geo(
                    type,
                    repeatgroup_cardinality > 0,
                    path,
                    safe_to_xml(submission_xml)
                ) as geovalue
                -- 2. end
            FROM
                geo_needed
            WHERE
                NOT is_cached
        ),
        -- insert cached values. We don't do this inline with the "geojsoned" CTE since RETURNING doesn't return
        -- non-modified (= clashing, because of concurrent updates) rows.
        inserted AS (
            INSERT INTO submission_field_extract_geo_cache (submission_def_id, fieldhash, geovalue)
                SELECT
                    submission_def_id,
                    fieldhash,
                    geovalue
                FROM geojsoned
            ON CONFLICT DO NOTHING
        ),
        unioned AS (
            SELECT
                "instanceId",
                path,
                geovalue
            FROM
                geojsoned
            WHERE
                geovalue IS NOT NULL

            UNION ALL  -- not expecting dupes, these come from non-overlapping subsets of geo_needed

            SELECT
                "instanceId",
                path,
                geovalue
            FROM
                geo_needed
            WHERE
                is_cached
                AND
                geovalue IS NOT NULL
        ),
        agged AS (
                SELECT
                    json_build_object(
                        'type', 'Feature',
                        'id', "instanceId",
                        'geometry', json_build_object(
                            'type', 'GeometryCollection',
                            'geometries', json_agg(geovalue)
                        )
                        ${doPathInProperties}
                    ) AS instancegeo
                FROM
                    unioned
                GROUP BY
                    "instanceId"
                    ${doAggregateByPath}
                ${queryLimit}
        )
    SELECT
        json_build_object(
            'type', 'FeatureCollection',
            'features', coalesce(
                json_agg(
                    agged.instancegeo
                ),
                json_build_array()
            )
        ) as geojson
    FROM
        agged
  `);
};


const getEntityFeatureCollectionGeoJson = (datasetPK, conflictStates) => ({ db }) => {

  const conflictStatusFilter = conflictStates.length ? (conflictStates.includes(null) ? sql`AND e.conflict IS NULL` : sql`AND e.conflict = ANY ((${sql.array(conflictStates, 'text')})::"conflictType"[])`) : sql``;

  return db.oneFirst(sql`
      WITH extracted AS (
          SELECT
              e.uuid,
              odk2geojson_ducktyped(ed.data ->> 'geometry') AS geojsoned
          FROM
              datasets ds
              INNER JOIN ds_properties dsprops ON (
                  dsprops."datasetId" = ${datasetPK}
                  AND
                  dsprops.name = 'geometry'
              )
              INNER JOIN entities e ON (
                  ds.id = ${datasetPK}
                  AND
                  e."datasetId" = ${datasetPK}
                  AND
                  e."deletedAt" IS NULL
                  ${conflictStatusFilter}
              )
              INNER JOIN entity_defs ed ON (
                  ed."entityId" = e.id
                  AND
                  ed.current
                  AND
                  (ed.data ? 'geometry' AND (ed.data ->> 'geometry' ~ '\\d'))  -- there's an index on this expression
              )
          ),
          featuregeojsoned AS (
              SELECT
                  json_build_object(
                      'type', 'Feature',
                      'id', uuid,
                      'properties', NULL,
                      'geometry', geojsoned
                  ) AS featuregeojson
              FROM
                  extracted
              WHERE
                  geojsoned IS NOT NULL
          )
          SELECT
              json_build_object(
                  'type', 'FeatureCollection',
                  'features', coalesce(
                      json_agg(featuregeojson),
                      json_build_array()
                  )
              ) AS geojson
          FROM
              featuregeojsoned
      `);
};

module.exports = {
  getSubmissionFeatureCollectionGeoJson,
  getEntityFeatureCollectionGeoJson,
};
