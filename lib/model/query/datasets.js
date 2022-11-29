// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { raw } = require('slonik-sql-tag-raw');
const { unjoiner } = require('../../util/db');
const { Dataset, Form } = require('../frames');
const { map, reduce, compose, pickBy, startsWith, nthArg, assoc, keys, curry, nth, isEmpty, isNil, either, reduceBy, groupBy } = require('ramda');
const { construct } = require('../../util/util');
const Option = require('../../util/option');
const Problem = require('../../util/problem');

// It removes prefix from all the key of an object
const removePrefix = curry((prefix, obj) => compose(reduce((acc, key) => assoc(key.replace(prefix, ''), obj[key], acc), {}), keys)(obj));

const pickFrameFields = (frame, obj) => compose(
  removePrefix(`${frame.def.from}!`),
  pickBy(compose(startsWith(`${frame.def.from}!`), nthArg(1)))
)(obj);

const makeHierarchy = reduce((result, item) => {
  const dataset = new Dataset(pickFrameFields(Dataset, item));
  const property = new Dataset.Property(pickFrameFields(Dataset.Property, item));

  return {
    ...result,
    [dataset.id]: {
      ...dataset,
      properties: !property.id ? { ...(result[dataset.id]?.properties || {}) } : {
        ...(result[dataset.id]?.properties || {}),
        [property.id]: property
      }
    }
  };
}, {});

const asArray = compose(map(d => ({ ...d, properties: Object.values(d.properties) })), Object.values);

// should be moved to util.js or we already have similar func somewhere?
const isNilOrEmpty = either(isNil, isEmpty);

////////////////////////////////////////////////////////////////////////////////
// SQL Queries
const _getAllByProjectId = (projectId) => sql`
  SELECT DISTINCT d.* FROM datasets d  
  WHERE d."publishedAt" IS NOT NULL AND d."projectId" = ${projectId}
`;

const _insertDatasetDef = (dataset, acteeId, withDsDefsCTE, publish) => sql`
  WITH ds AS (
    INSERT INTO datasets (id, name, "projectId", "revisionNumber", "createdAt", "acteeId", "publishedAt")
    VALUES (nextval(pg_get_serial_sequence('datasets', 'id')), ${dataset.name}, ${dataset.projectId}, 0, clock_timestamp(), ${acteeId}, ${(publish === true) ? sql`clock_timestamp()` : null})
    ON CONFLICT ON CONSTRAINT datasets_name_projectid_unique 
    DO UPDATE SET "revisionNumber" = datasets."revisionNumber" + 1
    RETURNING *
  )
  ${raw(withDsDefsCTE ? ', ds_defs AS (' : '')}
    INSERT INTO dataset_form_defs
    SELECT ds.id, ${dataset.aux.formDefId} FROM ds
    ON CONFLICT ON CONSTRAINT dataset_form_defs_datasetid_formdefid_unique 
    DO NOTHING
  ${raw(withDsDefsCTE ? '),' : '')}
`;

const _createOrMerge = (dataset, fields, acteeId, publish) => (isNilOrEmpty(fields) ? _insertDatasetDef(dataset, acteeId, false, publish) : sql`
${_insertDatasetDef(dataset, acteeId, true, publish)}
fields("propertyName", "formDefId", path) AS (VALUES      
  ${sql.join(fields.map(p => sql`( ${sql.join([p.aux.propertyName, p.formDefId, p.path], sql`,`)} )`), sql`,`)}
),
insert_properties AS (
    INSERT INTO ds_properties (id, name, "datasetId", "publishedAt")
    SELECT nextval(pg_get_serial_sequence('ds_properties', 'id')), fields."propertyName", ds.id, ${(publish === true) ? sql`clock_timestamp()` : null} FROM fields, ds
    ON CONFLICT  ON CONSTRAINT ds_properties_name_datasetid_unique
    DO NOTHING 
    RETURNING ds_properties.id, ds_properties.name, ds_properties."datasetId"
),
all_properties AS (
    (SELECT insert_properties.id "dsPropertyId", insert_properties.name "propertyName", fields."formDefId", fields.path FROM fields
    JOIN insert_properties ON fields."propertyName" = insert_properties.name)
    UNION 
    (SELECT ds_properties.id "dsPropertyId", ds_properties.name "propertyName", fields."formDefId", fields.path FROM fields
    JOIN ds_properties ON fields."propertyName" = ds_properties.name
    JOIN ds ON ds.id = ds_properties."datasetId")
)
INSERT INTO ds_property_fields
SELECT "dsPropertyId", "formDefId"::integer, path FROM all_properties
`);

const _getByIdSql = ((fields, datasetId) => sql`
       SELECT
           ${fields}
       FROM
           datasets
       LEFT OUTER JOIN ds_properties ON
           datasets.id = ds_properties."datasetId"
       WHERE datasets.id = ${datasetId}
    `);

const _getByNameSql = ((fields, datasetName, projectId) => sql`
    SELECT
        ${fields}
    FROM
        datasets
    LEFT OUTER JOIN ds_properties ON
        datasets.id = ds_properties."datasetId" AND ds_properties."publishedAt" IS NOT NULL
    WHERE datasets.name = ${datasetName}
      AND datasets."projectId" = ${projectId}
      AND datasets."publishedAt" IS NOT NULL
 `);


// Creates or merges dataset, properties and field mapping.
// Expects dataset:Frame auxed with `formDefId` and array of field:Frame auxed with `propertyName`
// Note from Kathleen: I apologize at how hacky it is to get the provisioned actee ID into this
// and get the created dataset out again...
const createOrMerge = (dataset, fields, publish = false) => ({ all, Actees, Datasets, Projects }) =>
  Promise.all([
    Projects.getById(dataset.projectId).then((o) => o.get()),
    Datasets.getByProjectAndName(dataset.projectId, dataset.name)
  ])
    .then(([project, datasetOption]) =>
      (datasetOption.isDefined()
        ? datasetOption.get().acteeId
        : Actees.provision('dataset', project).then((actee) => (actee.id))))
    .then((acteeId) =>
      all(_createOrMerge(dataset, fields, acteeId, publish))
        .catch(error => {
          if (error.constraint === 'ds_property_fields_dspropertyid_formdefid_unique') {
            throw Problem.user.invalidEntityForm({ reason: 'Multiple Form Fields cannot be saved to a single Dataset Property.' });
          }
          throw error;
        }))
    .then(() => Datasets.getByProjectAndName(dataset.projectId, dataset.name))
    .then((ds) => ((publish === true)
      ? Datasets.getPublishedProperties(ds.get().id).then(properties => ({ ...ds.get(), properties }))
      : ds.get()));

createOrMerge.audit = (dataset, _, fields, publish) => (log) =>
  ((dataset.revisionNumber === 0)
    ? log('dataset.create', dataset, { fields: fields.map((f) => [f.path, f.propertyName]) })
    : log('dataset.update', dataset, { fields: fields.map((f) => [f.path, f.propertyName]) }))
    .then(() => ((publish === true)
      ? log('dataset.update.publish', dataset, { properties: dataset.properties.map(p => p.name) })
      : null));
createOrMerge.audit.withResult = true;

// Returns dataset along with it properties and field mappings
const getById = (datasetId) => ({ all }) =>
  all(_getByIdSql(unjoiner(Dataset, Dataset.Property).fields, datasetId))
    .then(makeHierarchy)
    .then(asArray)
    .then(nth(0));

// Returns only published dataset with its published properties
const getByName = (datasetName, projectId) => ({ all }) =>
  all(_getByNameSql(unjoiner(Dataset, Dataset.Property).fields, datasetName, projectId))
    .then(makeHierarchy)
    .then(asArray)
    .then(nth(0))
    .then(Option.of);

// Returns list of dataset for a given projectId
// Properties and field mappings are not returned
const getAllByProjectId = (projectId) => ({ all }) => all(_getAllByProjectId(projectId)).then(map(construct(Dataset)));

// Returns list of Fields augmented by dataset property name OR entity creation information
// including label.
const getFieldsByFormDefId = (formDefId) => ({ all }) => all(sql`
SELECT
  form_fields.*, ds_properties."name" as "propertyName"
FROM
  form_fields
JOIN dataset_form_defs ON
  dataset_form_defs."formDefId" = form_fields."formDefId"
LEFT OUTER JOIN ds_property_fields ON
  ds_property_fields."formDefId" = form_fields."formDefId"
    AND ds_property_fields."path" = form_fields."path"
LEFT OUTER JOIN ds_properties ON
  ds_properties."id" = ds_property_fields."dsPropertyId"
WHERE form_fields."formDefId" = ${formDefId}
  AND (ds_properties."id" IS NOT NULL OR form_fields."path" LIKE '/meta/entity%')
ORDER BY form_fields."order"
`)
  .then((fields) => fields.map((field) => new Form.Field(field, { propertyName: field.propertyName })));

const getDatasetDiff = (projectId, xmlFormId, forDraft) => ({ all }) => all(sql`
  WITH form AS (
    SELECT f.id, f."xmlFormId", fd.id "formDefId" 
    FROM forms f
    JOIN form_defs fd ON fd.id = f.${forDraft ? sql.identifier(['draftDefId']) : sql.identifier(['currentDefId'])}
    WHERE "projectId" = ${projectId} AND "xmlFormId" = ${xmlFormId} AND f."deletedAt" IS NULL
  ),
  ds AS (
    SELECT d.id, d.name, dd."formDefId", d."publishedAt" IS NULL "isNew"
    FROM datasets d
    JOIN dataset_form_defs dd ON dd."datasetId" = d.id
    JOIN form f ON f."formDefId" = dd."formDefId"
  ),
  properties AS (
    SELECT 
      dp.*, 
      dpf.*, 
      dp."publishedAt" IS NULL "isNew"
    FROM ds_properties dp 
    JOIN ds ON ds.id = dp."datasetId"
    LEFT JOIN ds_property_fields dpf ON dpf."dsPropertyId" = dp.id
  )
  SELECT ds.name "datasetName", ds."isNew" "isDatasetNew", p.name "propertyName", p."isNew" "isPropertyNew", TRUE = ANY(ARRAY_AGG(f.id IS NOT NULL)) "inForm"
  FROM ds
  LEFT JOIN properties p on ds.id = p."datasetId"
  LEFT JOIN form f ON f."formDefId" = p."formDefId"
  ${forDraft ? sql`` : sql`WHERE p.id IS NULL OR NOT p."isNew"`}
  GROUP BY ds.name, ds."isNew", p.name, p."isNew"
  ORDER BY p.name
`)
  .then(reduceBy((acc, { propertyName, isPropertyNew, inForm }) => (propertyName ? acc.concat({ name: propertyName, isNew: forDraft ? isPropertyNew : undefined, inForm }) : acc), [], (row) => `${row.datasetName},${row.isDatasetNew}`))
  .then(r => Object.keys(r).map(k => ({ name: k.split(',')[0], isNew: forDraft ? k.split(',')[1] === 'true' : undefined, properties: r[k] })));

const getByProjectAndName = (projectId, name, excludeUnpublished = false) => ({ maybeOne }) => maybeOne(sql`
SELECT * FROM datasets WHERE "projectId" = ${projectId} AND name = ${name} ${excludeUnpublished ? sql`AND "publishedAt" IS NOT NULL` : sql``}`)
  .then(map(construct(Dataset)));

const getPublishedProperties = (id) => ({ all }) => all(sql`
SELECT * FROM ds_properties WHERE "datasetId" = ${id} AND "publishedAt" IS NOT NULL ORDER BY name`);

const publishIfExists = (formDefId, publishedAt) => ({ all }) => all(sql`
WITH properties_update as (
  UPDATE ds_properties dp SET "publishedAt" = ${publishedAt}
  FROM ds_property_fields dpf
  WHERE dpf."formDefId" = ${formDefId}
  AND dpf."dsPropertyId" = dp.id
  RETURNING *
), datasets_update as (
  UPDATE datasets ds SET "publishedAt" = ${publishedAt}
  FROM dataset_form_defs dfd
  WHERE dfd."formDefId" = ${formDefId}
  AND dfd."datasetId" = ds.id
  RETURNING *
)
-- selecting following for publish.audit
-- we are returning first row for dataset
-- because we want to log it even if no
-- property is published.
SELECT '' "name", ds.id, ds."acteeId"
FROM datasets_update ds
UNION
SELECT p.name, ds.id, ds."acteeId"
FROM properties_update p
JOIN datasets ds on ds.id = p."datasetId"
UNION
SELECT p.name, ds.id, ds."acteeId"
FROM ds_properties p
JOIN datasets ds on ds.id = p."datasetId"
JOIN dataset_form_defs dfd on dfd."datasetId" = ds.id
WHERE dfd."formDefId" = ${formDefId}
AND p."publishedAt" IS NOT NULL
`);

publishIfExists.audit = (properties) => (log) => {
  const promiseArr = [];
  const datasets = groupBy(c => c.acteeId, properties);

  for (const acteeId of Object.keys(datasets)) {
    promiseArr.push(log('dataset.update.publish', { acteeId }, {
      properties: datasets[acteeId].filter(p => p.name).map(p => p.name).sort()
    }));
  }

  return Promise.all(promiseArr);
};

publishIfExists.audit.withResult = true;

module.exports = {
  createOrMerge, publishIfExists,
  getById, getAllByProjectId, getByName,
  getFieldsByFormDefId, getPublishedProperties,
  getDatasetDiff, getByProjectAndName
};
