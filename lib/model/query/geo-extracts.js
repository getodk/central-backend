// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { arrayHasElements } = require('../../util/util');
const { searchClause } = require('./entities');
const { odataFilter, odataExcludeDeleted } = require('../../data/odata-filter');
const { DEFAULT_ORDER_BY } = require('./submissions');
const submissionData = require('../../data/submission');
const entityData = require('../../data/entity');
const odataToColumnMapSubmissions = submissionData.odataToColumnMap;
const odataToColumnMapEntities = entityData.odataToColumnMap;


const getSubmissionFeatureCollectionGeoJson = (formPK, odataQuery, fieldPaths, limit=null, onlyCurrent=true, assumeRootSubmissionId=true, versionId=null) => ({ db }) => {
  const onlyCurrentFilter = onlyCurrent ? sql`AND sdef.current` : sql``;
  const versionFilter = versionId ? sql`AND sdef."instanceId" = ${versionId}` : sql``;
  const formFieldFilter = arrayHasElements(fieldPaths) ? sql`AND ffgeo.path = ANY (${sql.array(fieldPaths, 'text')})` : sql`AND ffgeo.is_default`;
  const doPathInProperties = arrayHasElements(fieldPaths) ? sql`, 'properties', NULL` : sql`, 'properties', json_build_object('fieldpath', path)`;
  const doAggregateByPath = arrayHasElements(fieldPaths) ? sql`` : sql`, path`;
  // data coming from revisions are in some cases expected to take on the instanceId of the root of the edit-lineage. And in some other cases, not.
  const reportedInstanceIdPicker = assumeRootSubmissionId ? sql`CASE WHEN root THEN sdef."instanceId" ELSE submissions."instanceId" END as "instanceId"` : sql`sdef."instanceId"`;
  return db.oneFirst(sql`
        -- all targeted submission fields, with info on whether the geojson-value is cached
        WITH geo_needed AS (
            SELECT
                sxg.submission_def_id IS NOT NULL as is_cached,
                sdef.id as submission_def_id,
                ${reportedInstanceIdPicker},
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
                    ${onlyCurrentFilter}
                    ${versionFilter}
                )
                INNER JOIN submissions ON (
                    sdef."submissionId" = submissions.id
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
            WHERE
                ${odataFilter(odataQuery, odataToColumnMapSubmissions)}
                AND
                ${odataExcludeDeleted(odataQuery, odataToColumnMapSubmissions)}
            ${DEFAULT_ORDER_BY}
            LIMIT ${limit}
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
        )::text as geojson  -- why cast to text? Otherwise the DB adapter will try to read it as json, and it incorrectly deserializes the numbers into doubles, with potential loss of precision. Also, as the JS is already composed by Postgres, this should just go straight down the http socket as-is.
    FROM
        agged
  `);
};


const getEntityFeatureCollectionGeoJson = (datasetPK, odataQuery, limit=null, search=null) => ({ db }) => {

  const searchFilter = searchClause(search);


  return db.oneFirst(sql`
      WITH extracted AS (
          SELECT
              entities.uuid,
              odk2geojson_ducktyped(entity_defs.data ->> 'geometry') AS geojsoned
          FROM
              datasets ds
              INNER JOIN ds_properties dsprops ON (
                ds.id = ${datasetPK}
                AND
                (dsprops.name, dsprops."datasetId") = ('geometry', ds.id)
              )
              INNER JOIN entities ON (
                  entities."datasetId" = ds.id
              )
              INNER JOIN entity_defs ON (
                  entity_defs."entityId" = entities.id
                  AND
                  entity_defs.current
                  AND
                  (entity_defs.data ? 'geometry' AND (entity_defs.data ->> 'geometry' ~ '\\d'))  -- there's an index on this expression
              )
          WHERE
            ${searchFilter}
            AND
            ${odataFilter(odataQuery, odataToColumnMapEntities)}
            AND
            ${odataExcludeDeleted(odataQuery, odataToColumnMapEntities)}
          LIMIT ${limit}
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
              )::text AS geojson  -- why cast to text? Otherwise the DB adapter will try to read it as json, and it incorrectly deserializes the numbers into doubles, with potential loss of precision. Also, as the JS is already composed by Postgres, this should just go straight down the http socket as-is.
          FROM
              featuregeojsoned
      `);
};

module.exports = {
  getSubmissionFeatureCollectionGeoJson,
  getEntityFeatureCollectionGeoJson,
};
