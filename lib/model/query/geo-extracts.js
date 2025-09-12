// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');


const stateFilterToQueryFragments = (field, states, pgType = 'text') => {
  const alsoNullFilter = states.includes(null) ? sql`${sql.identifier(field)} IS NULL` : null;
  const theOtherStates = states.filter(el => el !== null);
  const alsoOtherStatesFilter = theOtherStates.length ? sql`${sql.identifier(field)} = ANY(${sql.array(theOtherStates, pgType)})` : null;
  const theFilters = [alsoNullFilter, alsoOtherStatesFilter].filter(el => el !== null);
  switch (theFilters.length) {
    case 1:
      return sql`AND ${theFilters[0]}`;
    case 2:
      return sql`AND ${theFilters[0]} OR ${theFilters[1]}`;
    default:
      return sql``;
  }
};

const getSubmissionFeatureCollectionGeoJson = (formPK, fieldPaths, submitterIds, TSTZRange, reviewStates, deleted, limit) => ({ db }) => {

  const formFieldFilter = fieldPaths.length ? sql`AND ffgeo.path = ANY (${sql.array(fieldPaths, 'text')})` : sql`AND ffgeo.is_default`;
  const doPathInProperties = fieldPaths.length ? sql`, 'properties', NULL` : sql`, 'properties', json_build_object('fieldpath', path)`;
  const doAggregateByPath = fieldPaths.length ? sql`` : sql`, path`;
  const submitterFilter = submitterIds.length ? sql`AND sdef."submitterId" = ANY(${sql.array(submitterIds, 'int4')})` : sql``;
  const TSTZRangeFilter = TSTZRange ? sql`AND sdef."createdAt" <@ tstzrange(${TSTZRange[0]}, ${TSTZRange[1]}, ${TSTZRange[2]})` : sql``;
  const reviewStateFilter = reviewStates.length ? stateFilterToQueryFragments(['sub', 'reviewState'], reviewStates) : sql``;
  const deletedFilter = deleted ? sql`IS NOT NULL` : sql`IS NULL`;
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
                    sub."deletedAt" ${deletedFilter}
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
            ${queryLimit}
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
                    CASE WHEN count(*) > 1
                        -- More than 1 geometry - wrap it in a GeometryCollection object
                        THEN json_build_object(
                            'type', 'Feature',
                            'id', "instanceId",
                            'geometry', json_build_object(
                                'type', 'GeometryCollection',
                                'geometries', json_agg(geovalue)
                            )
                            ${doPathInProperties}
                        ) 
                        -- Just one geometry - no wrapper needed
                        -- (apparently it's geojson-impolite to wrap if it's not strictly necessary)
                        ELSE json_build_object(
                            'type', 'Feature',
                            'id', "instanceId",
                            'geometry', (array_agg(geovalue))[1]
                            ${doPathInProperties}
                        )
                    END AS instancegeo
                FROM
                    unioned
                GROUP BY
                    "instanceId"
                    ${doAggregateByPath}
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


const getEntityFeatureCollectionGeoJson = (datasetPK, creatorIds, TSTZRange, conflictStates, deleted, limit) => ({ db }) => {

  const creatorFilter = creatorIds.length ? sql`AND e."creatorId" = ANY(${sql.array(creatorIds, 'int4')})` : sql``;
  const TSTZRangeFilter = TSTZRange ? sql`AND e."createdAt" <@ tstzrange(${TSTZRange[0]}, ${TSTZRange[1]}, ${TSTZRange[2]})` : sql``;
  const conflictStatusFilter = conflictStates.length ? stateFilterToQueryFragments(['e', 'conflict'], conflictStates, 'conflictType') : sql``;
  const deletedFilter = deleted ? sql`IS NOT NULL` : sql`IS NULL`;
  const queryLimit = limit ? sql`LIMIT ${limit}` : sql``;


  return db.oneFirst(sql`
      WITH extracted AS (
          SELECT
              e.uuid,
              odk2geojson_ducktyped(ed.data ->> 'geometry') AS geojsoned
          FROM
              datasets ds
              INNER JOIN ds_properties dsprops ON (
                ds.id = ${datasetPK}
                AND
                (dsprops.name, dsprops."datasetId") = ('geometry', ds.id)
              )
              INNER JOIN entities e ON (
                  e."datasetId" = ds.id
                  AND
                  e."deletedAt" ${deletedFilter}
                  ${creatorFilter}
                  ${TSTZRangeFilter}
                  ${conflictStatusFilter}
              )
              INNER JOIN entity_defs ed ON (
                  ed."entityId" = e.id
                  AND
                  ed.current
                  AND
                  (ed.data ? 'geometry' AND (ed.data ->> 'geometry' ~ '\\d'))  -- there's an index on this expression
              )
          ${queryLimit}
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
