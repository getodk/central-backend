// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { extender, QueryOptions, equals } = require('../../util/db');
const { Dataset, Form } = require('../frames');
const { isEmpty, isNil, either, reduceBy, groupBy, uniqWith, equals: rEquals } = require('ramda');

const Problem = require('../../util/problem');
const { construct } = require('../../util/util');

////////////////////////////////////////////////////////////////////////////
// DATASET CREATE AND UPDATE

// createOrUpdate is called from Forms.createNew and Forms.createVersion
const _insertDatasetDef = (dataset, acteeId, withDsDefsCTE, publish) => sql`
  WITH ds_ins AS (
    INSERT INTO datasets (id, name, "projectId", "createdAt", "acteeId", "publishedAt")
    VALUES (nextval(pg_get_serial_sequence('datasets', 'id')), ${dataset.name}, ${dataset.projectId}, clock_timestamp(), ${acteeId}, ${(publish === true) ? sql`clock_timestamp()` : null})
    ON CONFLICT ON CONSTRAINT datasets_name_projectid_unique 
    DO NOTHING
    RETURNING *
  ),
  ${publish ? sql`
  update_ds AS (
    UPDATE datasets SET "publishedAt" = clock_timestamp()
    WHERE name = ${dataset.name} AND "projectId" = ${dataset.projectId} AND "publishedAt" IS NULL
  ),
  ` : sql``}
  ds AS (
    SELECT *, 'created' "action" FROM ds_ins
    UNION ALL
    SELECT *, 'updated' "action" FROM datasets WHERE name = ${dataset.name} AND "projectId" = ${dataset.projectId}
  ),
  ds_defs AS (
    INSERT INTO dataset_form_defs
    SELECT ds.id, ${dataset.aux.formDefId} FROM ds
    ON CONFLICT ON CONSTRAINT dataset_form_defs_datasetid_formdefid_unique 
    DO NOTHING
  )
`;

const _insertProperties = (fields, publish) => sql`
,fields("propertyName", "formDefId", "schemaId", path) AS (VALUES      
  ${sql.join(fields.map(p => sql`( ${sql.join([p.aux.propertyName, p.aux.formDefId, p.schemaId, p.path], sql`,`)} )`), sql`,`)}
),
insert_properties AS (
    INSERT INTO ds_properties (id, name, "datasetId", "publishedAt")
    SELECT nextval(pg_get_serial_sequence('ds_properties', 'id')), fields."propertyName", ds.id, ${(publish === true) ? sql`clock_timestamp()` : null} FROM fields, ds
    ON CONFLICT  ON CONSTRAINT ds_properties_name_datasetid_unique
    DO NOTHING 
    RETURNING ds_properties.id, ds_properties.name, ds_properties."datasetId"
),
all_properties AS (
    (SELECT insert_properties.id "dsPropertyId", insert_properties.name "propertyName", fields."formDefId", fields."schemaId", fields.path FROM fields
    JOIN insert_properties ON fields."propertyName" = insert_properties.name)
    UNION 
    (SELECT ds_properties.id "dsPropertyId", ds_properties.name "propertyName", fields."formDefId", fields."schemaId", fields.path FROM fields
    JOIN ds_properties ON fields."propertyName" = ds_properties.name
    JOIN ds ON ds.id = ds_properties."datasetId")
),
insert_property_fields AS (
  INSERT INTO ds_property_fields ("dsPropertyId", "formDefId", "schemaId", "path")
  SELECT "dsPropertyId", "formDefId"::integer, "schemaId"::integer, path FROM all_properties
)
${publish ? sql`
,
update_ds_properties AS (
  UPDATE ds_properties SET "publishedAt" = clock_timestamp()
  FROM all_properties
  WHERE ds_properties.id = all_properties."dsPropertyId" AND ds_properties."publishedAt" IS NULL
)
` : sql``}
`;

// should be moved to util.js or we already have similar func somewhere?
const isNilOrEmpty = either(isNil, isEmpty);

const _createOrMerge = (dataset, fields, acteeId, publish) => sql`
${_insertDatasetDef(dataset, acteeId, true, publish)}
${isNilOrEmpty(fields) ? sql`` : _insertProperties(fields, publish)}
SELECT "action", "id" FROM ds
`;

// Takes the dataset name and field->property mappings defined in a form
// and creates or updates the named dataset.
// Arguments:
// * dataset name
// * form (a Form frame or object containing projectId, formDefId, and schemaId)
// * array of field objects and property names that were parsed from the form xml
// * publish flag saying whether or not to immediately publish the dataset
const createOrMerge = (name, form, fields, publish) => async ({ one, Actees, Datasets, Projects }) => {
  const { projectId } = form;
  const { id: formDefId, schemaId } = form.def;

  // Provision acteeId if necessary.
  // Need to check for existing dataset, and if not found, need to also
  // fetch the project since the dataset will be an actee child of the project.
  const existingDataset = await Datasets.get(projectId, name);
  const acteeId = existingDataset.isDefined()
    ? existingDataset.get().acteeId
    : await Projects.getById(projectId).then((o) => o.get())
      .then((project) => Actees.provision('dataset', project))
      .then((actee) => (actee.id));
  const partial = new Dataset({ name, projectId, acteeId }, { formDefId });

  // Prepare dataset properties from form fields:
  // Step 1: Filter to only fields with property name binds
  let dsPropertyFields = fields.filter((field) => (field.propertyName));
  // Step 2: Disallow properties to be named "name" or "label"
  if (dsPropertyFields.filter((field) => field.propertyName === 'name' || field.propertyName === 'label').length > 0)
    throw Problem.user.invalidEntityForm({ reason: 'Invalid Dataset property.' });
  // Step 3: Build Form Field frames to handle dataset property field insertion
  dsPropertyFields = dsPropertyFields.map((field) => new Form.Field(field, { propertyName: field.propertyName, schemaId, formDefId }));

  // Insert or update: update dataset, dataset properties, and links to fields and current form
  // result contains action (created or updated) and the id of the dataset.
  const result = await one(_createOrMerge(partial, dsPropertyFields, acteeId, publish))
    .catch(error => {
      if (error.constraint === 'ds_property_fields_dspropertyid_formdefid_unique') {
        throw Problem.user.invalidEntityForm({ reason: 'Multiple Form Fields cannot be saved to a single Dataset Property.' });
      }
      throw error;
    });

  // Fetch all published properties for this dataset, even beyond what is defined in this form.
  const publishedProperties = ((publish === true)
    ? await Datasets.getProperties(result.id)
    : null);

  // Partial contains acteeId which is needed for auditing.
  // Additional form fields and properties needed for audit logging as well.
  return partial.with({ action: result.action, fields: dsPropertyFields, properties: publishedProperties });
};

createOrMerge.audit = (dataset, name, form, fields, publish) => (log) =>
  ((dataset.action === 'created')
    ? log('dataset.create', dataset, { fields: dataset.fields.map((f) => [f.path, f.propertyName]) })
    : log('dataset.update', dataset, { fields: dataset.fields.map((f) => [f.path, f.propertyName]) }))
    .then(() => ((publish === true)
      ? log('dataset.update.publish', dataset, { properties: dataset.properties.map(p => p.name) })
      : null));
createOrMerge.audit.withResult = true;

////////////////////////////////////////////////////////////////////////////
// DATASET (AND DATASET PROPERTY) PUBLISH

// Called by Forms.publish.
// createOrMerge may also publish datasets and properties within datasets.

const publishIfExists = (formDefId, publishedAt) => ({ all }) => all(sql`
WITH properties_update as (
  UPDATE ds_properties dp SET "publishedAt" = ${publishedAt}
  FROM ds_property_fields dpf
  JOIN form_schemas fs ON fs."id" = dpf."schemaId"
  JOIN form_defs fd ON fs."id" = fd."schemaId"
  WHERE fd."id" = ${formDefId}
  AND dpf."dsPropertyId" = dp.id
  AND dp."publishedAt" IS NULL
  RETURNING dp.*
), datasets_update as (
  UPDATE datasets ds SET "publishedAt" = ${publishedAt}
  FROM dataset_form_defs dfd
  WHERE dfd."formDefId" = ${formDefId}
  AND dfd."datasetId" = ds.id
  AND ds."publishedAt" IS NULL
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


////////////////////////////////////////////////////////////////////////////
// DATASET GETTERS

const _get = extender(Dataset)(Dataset.Extended)((fields, extend, options, publishedOnly = false) => sql`
  SELECT ${fields} FROM datasets
  ${extend|| sql`
  LEFT JOIN (
    SELECT "datasetId", COUNT(1) "entities", MAX(COALESCE("updatedAt", "createdAt")) "lastEntity"
    FROM entities e
    GROUP BY "datasetId"
  ) stats on stats."datasetId" = datasets.id`}
  WHERE ${equals(options.condition)}
    ${publishedOnly ? sql`AND "publishedAt" IS NOT NULL` : sql``}
  ORDER BY name ASC
`);

// Get all published datasets for a specific project.
const getList = (projectId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ projectId }), true);

// Get a dataset by it's project id and name. Commonly used in a resource.
const get = (projectId, name, publishedOnly = false, extended = false) => ({ maybeOne }) => {
  const options = extended ? QueryOptions.extended : QueryOptions.none;
  return _get(maybeOne, options.withCondition({ projectId, name }), publishedOnly);
};

// Get by dataset ID - return only published dataset
const getById = (id, extended = false) => ({ maybeOne }) => {
  const options = extended ? QueryOptions.extended : QueryOptions.none;
  return _get(maybeOne, options.withCondition({ id }), true);
};



////////////////////////////////////////////////////////////////////////////////
// DATASET METADATA GETTERS

// Gets the dataset information, properties (including which forms each property comes from),
// and which forms consume the dataset via CSV attachment.
const getMetadata = (dataset) => async ({ all, Datasets }) => {

  const _getLinkedForms = (datasetName, projectId) => sql`
    SELECT DISTINCT f."xmlFormId", coalesce(fd.name, f."xmlFormId") "name" FROM form_attachments fa
    JOIN forms f ON f.id = fa."formId"
    JOIN form_defs fd ON f."currentDefId" = fd.id
    JOIN datasets ds ON ds.id = fa."datasetId"
    WHERE ds.name = ${datasetName}
      AND ds."projectId" = ${projectId}
      AND ds."publishedAt" IS NOT NULL
  `;

  const properties = await Datasets.getProperties(dataset.id, true);
  const linkedForms = await all(_getLinkedForms(dataset.name, dataset.projectId));

  const propertiesMap = new Map();
  for (const property of properties) {
    // put property in the map if not there yet
    if (!propertiesMap.has(property.name)) {
      propertiesMap.set(property.name, {
        ...property,
        forms: []
      });
    }

    // populate forms for each property
    if (property.aux.xmlFormId) {
      propertiesMap.get(property.name).forms.push({
        xmlFormId: property.aux.xmlFormId,
        // TODO: check that returning null name works ok in frontend.
        name: property.aux.formName
          ? property.aux.formName
          : property.aux.xmlFormId
      });
    }
  }

  // return all dataset metadata
  return {
    ...dataset.forApi(),
    linkedForms,
    properties: Array.from(propertiesMap.values())
  };
};


////////////////////////////////////////////////////////////////////////////
// DATASET PROPERTY GETTERS

// Returns a list of published properties for a dataset, ordered by
// their published timestamps and field order within a single form.
// If 'includeForms' is true, xmlFormId and formName is added to the aux and
// Dataset.Property will be duplicated for each form that writes that
// property in the dataset. Expect Dataset.Property to have NULL 'xmlFormId'
// if any form had created the property but was later deleted/purged.
const getProperties = (datasetId, includeForms = false) => ({ all }) => all(sql`
  SELECT
      ds_properties.* ${includeForms ? sql`, form_defs."name" as "formName", forms."xmlFormId"` : sql``}
  FROM
    ds_properties
  LEFT OUTER JOIN ds_property_fields ON
      ds_properties.id = ds_property_fields."dsPropertyId"
  LEFT OUTER JOIN form_fields ON
      ds_property_fields.path = form_fields.path
      AND ds_property_fields."schemaId" = form_fields."schemaId"
  ${includeForms ? sql`
  LEFT OUTER JOIN forms ON
      ds_property_fields."formDefId" = forms."currentDefId"
      AND forms."deletedAt" IS NULL
  LEFT JOIN form_defs ON
      forms."currentDefId" = form_defs.id
  ` : sql``}
  WHERE ds_properties."datasetId" = ${datasetId}
    AND ds_properties."publishedAt" IS NOT NULL
  ORDER BY ds_properties."publishedAt", form_fields.order, ds_properties.id
`)
  .then((rows) => (includeForms
    ? rows.map(({ formName, xmlFormId, ...row }) => new Dataset.Property(row, { formName, xmlFormId }))
    : uniqWith(rEquals, rows).map(construct(Dataset.Property))));

// Returns list of Fields augmented by dataset property name.
// This it used by the submission XML parser to create an entity from a submission.
const getFieldsByFormDefId = (formDefId) => ({ all }) => all(sql`
SELECT
  form_fields.*, ds_properties."name" as "propertyName"
FROM
  form_fields
JOIN form_schemas fs ON fs.id = form_fields."schemaId"
JOIN form_defs ON fs.id = form_defs."schemaId"
JOIN dataset_form_defs ON
  dataset_form_defs."formDefId" = form_defs."id"
LEFT OUTER JOIN ds_property_fields ON
  ds_property_fields."schemaId" = form_fields."schemaId"
    AND ds_property_fields."path" = form_fields."path"
LEFT OUTER JOIN ds_properties ON
  ds_properties."id" = ds_property_fields."dsPropertyId"
WHERE form_defs."id" = ${formDefId}
  AND (ds_properties."id" IS NOT NULL OR form_fields."path" LIKE '/meta/entity%')
ORDER BY form_fields."order"
`)
  .then((fields) => fields.map((field) => new Form.Field(field, { propertyName: field.propertyName })));


////////////////////////////////////////////////////////////////////////////
// DATASET DIFF

// Used when creating or updating a dataset through the uploading of a form
// to show the status of the dataset and each property in that dataset.
const getDiff = (projectId, xmlFormId, forDraft) => ({ all }) => all(sql`
  WITH form AS (
    SELECT f.id, f."xmlFormId", fd.id "formDefId", fd."schemaId"
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


module.exports = {
  createOrMerge, publishIfExists,
  getList, get, getById,
  getMetadata,
  getProperties, getFieldsByFormDefId,
  getDiff
};
