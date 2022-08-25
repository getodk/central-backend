// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { unjoiner } = require('../../util/db');
const { Dataset } = require('../frames/dataset');
const { map, reduce, compose, pickBy, startsWith, nthArg, assoc, keys, curry, nth, isEmpty, isNil, either } = require('ramda');
const { construct } = require('../../util/util');

// It removes prefix from all the key of an object
const removePrefix = curry((prefix, obj) => compose(reduce((acc, key) => assoc(key.replace(prefix, ''), obj[key], acc), {}), keys)(obj));

const pickFrameFields = (frame, obj) => compose(
  removePrefix(`${frame.def.from}!`),
  pickBy(compose(startsWith(`${frame.def.from}!`), nthArg(1)))
)(obj);

const makeHierarchy = reduce((result, item) => {
  const dataset = new Dataset(pickFrameFields(Dataset, item)).forApi();
  const property = new Dataset.Property(pickFrameFields(Dataset.Property, item)).forApi();
  const propertyField = new Dataset.PropertyField(pickFrameFields(Dataset.PropertyField, item)).forApi();

  return { ...result,
    [dataset.id]: {
      ...dataset,
      properties: !property.id ? { ...(result[dataset.id]?.properties || {}) } : {
        ...(result[dataset.id]?.properties || {}),
        [property.id]: {
          ...property,
          fields: [
            ...(result[dataset.id]?.properties[property.id]?.fields || []),
            propertyField
          ]
        }
      }
    } };
}, {});

const asArray = compose(map(d => ({ ...d, properties: Object.values(d.properties) })), Object.values);

// should be moved to util.js or we already have similar func somewhere?
const isNilOrEmpty = either(isNil, isEmpty);

////////////////////////////////////////////////////////////////////////////////
// SQL Queries
const _getAllByProjectId = (projectId) => sql`select ${Dataset.fieldlist} from datasets WHERE "projectId" = ${projectId}`;

const _createDatasetSql = dataset => sql`
INSERT INTO datasets VALUES 
(nextval(pg_get_serial_sequence('datasets', 'id')), ${dataset.name}, ${dataset.projectId}, 0) 
ON CONFLICT ON CONSTRAINT datasets_name_projectid_unique 
DO UPDATE SET "revisionNumber" = datasets."revisionNumber" + 1`;

const _createOrMerge = (dataset, fields) => (isNilOrEmpty(fields) ? _createDatasetSql(dataset) : sql`
WITH ds AS (
    ${_createDatasetSql(dataset)} 
    RETURNING *
),
fields("propertyName", "formDefId", path) AS (VALUES      
  ${sql.join(fields.map(p => sql`( ${sql.join([p.aux.propertyName, p.formDefId, p.path], sql`,`)} )`), sql`,`)}
),
dsProperties AS (
    INSERT INTO ds_properties 
    SELECT nextval(pg_get_serial_sequence('ds_properties', 'id')), fields."propertyName", ds.id FROM fields, ds
    ON CONFLICT  ON CONSTRAINT ds_properties_name_datasetid_unique
    DO NOTHING 
    RETURNING ds_properties.id, ds_properties.name, ds_properties."datasetId"
),
dsPropertiesAll AS (
    (SELECT dsProperties.id "dsPropertyId", dsProperties.name "propertyName", fields."formDefId", fields.path FROM fields
    JOIN dsProperties ON fields."propertyName" = dsProperties.name)
    UNION 
    (SELECT ds_properties.id "dsPropertyId", ds_properties.name "propertyName", fields."formDefId", fields.path FROM fields
    JOIN ds_properties ON fields."propertyName" = ds_properties.name)
)
INSERT INTO ds_property_fields
SELECT "dsPropertyId", "formDefId"::integer, path FROM dsPropertiesAll
ON CONFLICT ON CONSTRAINT ds_property_fields_dspropertyid_formdefid_path_unique 
DO NOTHING
`);

const _getByIdSql = ((fields, datasetId) => sql`
       SELECT
           ${fields}
       FROM
           datasets
       LEFT OUTER JOIN ds_properties ON
           datasets.id = ds_properties."datasetId"
       LEFT OUTER JOIN ds_property_fields ON
           ds_properties.id = ds_property_fields."dsPropertyId"
       WHERE datasets.id = ${datasetId}
    `);


// Creates or merges dataset, properties and field mapping.
// Expects dataset:Frame and array of field:Frame auxed with property `name`
// Returns dataset:Frame and array of properties:Frame if there are newly created
// so that this can be shown on frontend.
// Few scenarios:
// 1) If dataset, properties and mapping already exists then return nothing.
// 2) If there's difference between existing properties and given fields then only
//    newly created properties are returned.
// 3) If given field mapping is different then existing mapping then new mapping is
//    created but nothing is return.
const createOrMerge = (dataset, fields) => ({ all }) =>
  all(_createOrMerge(dataset, fields));

// Returns dataset along with it properties and field mappings
const getById = (datasetId) => ({ all }) =>
  all(_getByIdSql(unjoiner(Dataset, Dataset.Property, Dataset.PropertyField).fields, datasetId))
    .then(makeHierarchy)
    .then(asArray)
    .then(nth(0));

// Returns list of dataset for a given projectId
// Properties and field mappings are not returned
const getAllByProjectId = (projectId) => ({ all }) => all(_getAllByProjectId(projectId)).then(map(construct(Dataset)));

module.exports = { createOrMerge, getById, getAllByProjectId };
