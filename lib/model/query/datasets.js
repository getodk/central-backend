// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { extender, insert, QueryOptions, sqlEquals, unjoiner, updater } = require('../../util/db');
const { Dataset, Form, Audit } = require('../frames');
const { validatePropertyName } = require('../../data/dataset');
const { difference, isEmpty, isNil, either, reduceBy, groupBy, uniqWith, equals, map, pipe, values, any, prop, toLower } = require('ramda');

const Problem = require('../../util/problem');
const { construct } = require('../../util/util');
const { sanitizeOdataIdentifier } = require('../../util/util');

////////////////////////////////////////////////////////////////////////////
// DATASET CREATE AND UPDATE

const _insertDatasetDef = (dataset, acteeId, actions) => sql`
  WITH ds_ins AS (
    INSERT INTO datasets (id, name, "projectId", "createdAt", "acteeId")
    VALUES (nextval(pg_get_serial_sequence('datasets', 'id')), ${dataset.name}, ${dataset.projectId}, clock_timestamp(), ${acteeId})
    ON CONFLICT ON CONSTRAINT datasets_name_projectid_unique 
    DO NOTHING
    RETURNING *
  ),
  ds AS (
    SELECT *, 'created' "action" FROM ds_ins
    UNION ALL
    SELECT *, 'updated' "action" FROM datasets WHERE name = ${dataset.name} AND "projectId" = ${dataset.projectId}
  ),
  ds_defs AS (
    INSERT INTO dataset_form_defs
    SELECT ds.id, ${dataset.aux.formDefId}, ${JSON.stringify(actions)} FROM ds
    ON CONFLICT ON CONSTRAINT dataset_form_defs_datasetid_formdefid_unique 
    DO NOTHING
  )
`;

const _insertProperties = (fields) => sql`
,fields("propertyName", "formDefId", "schemaId", path) AS (VALUES      
  ${sql.join(fields.map(p => sql`( ${sql.join([p.aux.propertyName, p.aux.formDefId, p.aux.schemaId, p.path], sql`,`)} )`), sql`,`)}
),
insert_properties AS (
    INSERT INTO ds_properties (id, name, "datasetId")
    SELECT nextval(pg_get_serial_sequence('ds_properties', 'id')), fields."propertyName", ds.id FROM fields, ds
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
  INSERT INTO ds_property_fields ("dsPropertyId", "formDefId", "path")
  SELECT "dsPropertyId", "formDefId"::integer, path FROM all_properties
)
`;

// should be moved to util.js or we already have similar func somewhere?
const isNilOrEmpty = either(isNil, isEmpty);

const _createOrMerge = (dataset, acteeId, actions, fields) => sql`
${_insertDatasetDef(dataset, acteeId, actions)}
${isNilOrEmpty(fields) ? sql`` : _insertProperties(fields)}
SELECT "action", "id" FROM ds
`;

// Takes information about the dataset parsed from the form XML, as well as
// field->property mappings defined in a form, then creates or updates the named
// dataset.
// Arguments:
// * information about the dataset parsed from the form XML
// * form (a Form frame or object containing projectId, formDefId, and schemaId)
// * array of field objects and property names that were parsed from the form xml
//   (form fields do not need any extra IDs of the form, form def, or schema.)
const createOrMerge = (parsedDataset, form, fields) => async ({ context, one, Actees, Datasets, Projects }) => {
  const { projectId } = form;
  const { id: formDefId, schemaId } = form.def;

  // Provision acteeId if necessary.
  // Need to check for existing dataset, and if not found, need to also
  // fetch the project since the dataset will be an actee child of the project.
  const { name } = parsedDataset;

  // Check for a published dataset with a conflicting name (same name, different capitalization).
  // There can be multiple draft datasets with conflicting names but we won't throw an error
  // until publishing.
  const conflictingName = await Datasets.getPublishedBySimilarName(projectId, name);
  if (conflictingName.isDefined())
    throw Problem.user.datasetNameConflict({ current: conflictingName.get().name, provided: name });

  const existingDataset = await Datasets.get(projectId, name, false);
  const acteeId = existingDataset.isDefined()
    ? existingDataset.get().acteeId
    : await Projects.getById(projectId).then((o) => o.get())
      .then((project) => Actees.provision('dataset', project))
      .then((actee) => (actee.id));
  const partial = new Dataset({ name, projectId, acteeId }, { formDefId });

  // Prepare dataset properties from form fields:
  // Step 1: Filter to only fields with property name binds
  let dsPropertyFields = fields.filter((field) => (field.propertyName));
  // Step 2a: Check for invalid property names
  if (dsPropertyFields.filter((field) => !validatePropertyName(field.propertyName)).length > 0)
    throw Problem.user.invalidEntityForm({ reason: 'Invalid entity property name.' });

  // Step 2b: Multiple fields trying to save to a single property (case-insensitive)
  const hasDuplicateProperties = pipe(groupBy(pipe(prop('propertyName'), toLower)), values, any(g => g.length > 1));
  if (hasDuplicateProperties(dsPropertyFields)) {
    throw Problem.user.invalidEntityForm({ reason: 'Multiple Form Fields cannot be saved to a single property.' });
  }

  // Step 3: Build Form Field frames to handle dataset property field insertion
  dsPropertyFields = dsPropertyFields.map((field) => new Form.Field(field, { propertyName: field.propertyName, schemaId, formDefId }));

  // Insert or update: update dataset, dataset properties, and links to fields and current form
  // result contains action (created or updated) and the id of the dataset.
  const result = await one(_createOrMerge(partial, acteeId, parsedDataset.actions, dsPropertyFields));

  // Verify that user has ability to create dataset
  // Updating an unpublished dataset is equivalent to creating the dataset
  if (result.action === 'created' || (result.action === 'updated' && existingDataset.get().publishedAt == null))
    await context.auth.canOrReject('dataset.create', { acteeId });

  // Verify that user has ability to update dataset
  if (result.action === 'updated') {
    // Only consider updates that add new properties to the dataset
    const existingProperties = await Datasets.getProperties(existingDataset.get().id);
    const existingNames = existingProperties.map(f => f.name);
    const newNames = dsPropertyFields.map(f => f.propertyName);
    if (difference(newNames, existingNames).length > 0)
      await context.auth.canOrReject('dataset.update', { acteeId });

    // Check properties with same name but different capitualization
    const duplicateProperties = newNames
      .filter(newName => !existingNames.includes(newName))
      .map(newName => ({
        current: existingNames.find(existingName => newName.toLowerCase() === existingName.toLowerCase()),
        provided: newName
      }))
      .filter(property => property.current);
    if (duplicateProperties.length > 0) {
      throw Problem.user.propertyNameConflict({ duplicateProperties });
    }
  }

  // Partial contains acteeId which is needed for auditing.
  // Additional form fields and properties needed for audit logging as well.
  return partial.with({ action: result.action, fields: dsPropertyFields });
};

// Insert a Dataset when there is no associated form and immediately publish
const createPublishedDataset = (dataset, project) => async ({ one, Actees, Datasets }) => {

  // Check for a published dataset with a similar name but different capitalization
  const conflictingName = await Datasets.getPublishedBySimilarName(project.id, dataset.name);
  if (conflictingName.isDefined())
    throw Problem.user.datasetNameConflict({ current: conflictingName.get().name, provided: dataset.name });

  // Check for existing dataset with the same name
  const existingDataset = await Datasets.get(project.id, dataset.name, false);
  if (existingDataset.isDefined()) {
    const { publishedAt, id: datasetId } = existingDataset.get();
    if (publishedAt)
      throw Problem.user.uniquenessViolation({ table: 'datasets', fields: [ 'name', 'projectId' ], values: [ dataset.name, project.id ] });

    // If existing dataset is only a draft, allow it to be published
    return new Dataset(await one(sql`UPDATE datasets SET "publishedAt" = clock_timestamp() where id = ${datasetId} RETURNING *`));
  }

  // Final case: publish a completely new dataset
  const actee = await Actees.provision('dataset', project);
  const dsWithId = await one(insert(dataset.with({ acteeId: actee.id })));
  return new Dataset(await one(sql`UPDATE datasets SET "publishedAt" = "createdAt" where id = ${dsWithId.id} RETURNING *`));
};

createPublishedDataset.audit = (dataset) => (log) =>
  log('dataset.create', dataset, { properties: [] });
createPublishedDataset.audit.withResult = true;

// Insert a Dataset Property when there is no associated form and immediately publish
const _createPublishedProperty = (property) => sql`
INSERT INTO ds_properties ("name", "datasetId", "publishedAt")
VALUES (${property.name}, ${property.datasetId}, clock_timestamp())
ON CONFLICT ("name", "datasetId")
DO UPDATE SET "publishedAt" = clock_timestamp()
WHERE ds_properties."publishedAt" IS NULL
RETURNING *`;

const _getDuplicatePropertyName = (property) => sql`
  SELECT name FROM ds_properties 
  WHERE lower(name) = lower(${property.name})
    AND "datasetId" = ${property.datasetId} 
    AND "publishedAt" IS NOT NULL
`;

// eslint-disable-next-line no-unused-vars
const createPublishedProperty = (property, dataset) => async ({ all, maybeOne }) => {

  const duplicateProperty = await maybeOne(_getDuplicatePropertyName(property));
  if (duplicateProperty.isDefined()) {
    throw Problem.user.uniquenessViolation({ table: 'ds_properties', fields: [ 'name', 'datasetId' ], values: [ duplicateProperty.get().name, dataset.id ] });
  }

  const result = await all(_createPublishedProperty(property));
  if (result.length === 0)
    throw Problem.user.uniquenessViolation({ table: 'ds_properties', fields: [ 'name', 'datasetId' ], values: [ property.name, dataset.id ] });
  return result[0];
};

createPublishedProperty.audit = (property, dataset) => (log) =>
  log('dataset.update', dataset, { properties: [property.name] });

////////////////////////////////////////////////////////////////////////////
// DATASET (AND DATASET PROPERTY) PUBLISH

// Publishes the Dataset if it exists, noop if it doesn't.
// `IfExists` part is particularly helpful for `Forms.publish`,
// with that it doesn't need to ensure the existence of the Dataset
// and it can call this function blindly
const publishIfExists = (formDefId, publishedAt) => async ({ all, context, maybeOne }) => {

  // Helper sub-queries
  const _publishIfExists = () => sql`
  WITH properties_update as (
    UPDATE ds_properties dp SET "publishedAt" = ${publishedAt}
    FROM ds_property_fields dpf
    WHERE dpf."formDefId" = ${formDefId}
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
  SELECT -1 "propertyId", '' "name", ds.id, ds."acteeId", 'datasetCreated' action
  FROM datasets_update ds
  UNION
  SELECT p.id "propertyId", p.name, ds.id, ds."acteeId", 'propertyAdded' action
  FROM properties_update p
  JOIN datasets ds on ds.id = p."datasetId"
  UNION
  SELECT p.id "propertyId", p.name, ds.id, ds."acteeId", 'noop' action
  FROM ds_properties p
  JOIN datasets ds on ds.id = p."datasetId"
  JOIN dataset_form_defs dfd on dfd."datasetId" = ds.id
  WHERE dfd."formDefId" = ${formDefId}
  AND p."publishedAt" IS NOT NULL
  ORDER BY "propertyId"
  `;

  const _datasetNameConflict = () => sql`
    SELECT existing_ds.name AS current, ds_to_publish.name AS provided
    FROM dataset_form_defs dfd
    JOIN form_defs ON form_defs.id = dfd."formDefId"
    JOIN forms ON forms.id = form_defs."formId"
    JOIN datasets ds_to_publish ON dfd."datasetId" = ds_to_publish.id
    JOIN datasets existing_ds ON LOWER(ds_to_publish.name) = LOWER(existing_ds.name)
      AND ds_to_publish.id != existing_ds.id
      AND existing_ds."publishedAt" IS NOT NULL
      AND existing_ds."projectId" = forms."projectId"
    WHERE form_defs."id" = ${formDefId}
      AND ds_to_publish."publishedAt" IS NULL
  `;

  const _propertyNameConflict = () => sql`
    SELECT dp.name as provided, existing_properties.name as current
    FROM ds_property_fields dpf
    JOIN ds_properties dp ON dp.id = dpf."dsPropertyId"
    JOIN datasets ds ON ds.id = dp."datasetId"
    JOIN ds_properties existing_properties ON existing_properties."datasetId" = ds.id
      AND LOWER(dp.name) = LOWER(existing_properties.name)
    WHERE dpf."formDefId" = ${formDefId}
      AND existing_properties."publishedAt" IS NOT NULL
      AND dp."publishedAt" IS NULL
  `;

  const d = await maybeOne(_datasetNameConflict());
  if (d.isDefined()) {
    const { current, provided } = d.get();
    throw Problem.user.datasetNameConflict({ current, provided });
  }

  const duplicateProperties = await all(_propertyNameConflict());
  if (duplicateProperties.length > 0) {
    throw Problem.user.propertyNameConflict({ duplicateProperties });
  }

  const properties = await all(_publishIfExists());
  // `properties` contains a list of objects with the following structure:
  //    property id, property name, dataset id, dataset actee id, and action
  // The action for a property may be 'propertyAdded' if it is newly published
  // or 'noop' if it existed in the dataset already.
  // A fake property with id -1 is included when dataset is newly created,
  //   with action 'datasetCreated'
  const datasets = groupBy(c => c.acteeId, properties);

  for (const acteeId of Object.keys(datasets)) {
    if (datasets[acteeId].some(p => p.action === 'datasetCreated')) {
      // Dataset has been newly created (published) so check dataset.create

      // eslint-disable-next-line no-await-in-loop
      await context.auth.canOrReject('dataset.create', { acteeId });
    } else if (datasets[acteeId].some(p => p.action === 'propertyAdded')) {
      // Dataset has newly published properties so check dataset.update

      // eslint-disable-next-line no-await-in-loop
      await context.auth.canOrReject('dataset.update', { acteeId });
    }
    // Else the dataset had no new properties added, so no need to check any verbs.
  }

  return properties;
};

publishIfExists.audit = (properties) => (log) => {
  const promiseArr = [];
  const datasets = groupBy(c => c.acteeId, properties);

  for (const acteeId of Object.keys(datasets)) {

    const event = datasets[acteeId].some(p => p.action === 'datasetCreated') ? 'dataset.create' : 'dataset.update';

    // In case of update, we don't want to log anything if no new property is published
    if (event === 'dataset.create' || (event === 'dataset.update' && datasets[acteeId].some(p => p.action === 'propertyAdded'))) {
      promiseArr.push(log(event, { acteeId }, {
        properties: datasets[acteeId].filter(p => p.name).map(p => p.name)
      }));
    }

  }

  return Promise.all(promiseArr);
};

publishIfExists.audit.withResult = true;


////////////////////////////////////////////////////////////////////////////
// DATASET GETTERS

const _get = extender(Dataset)(Dataset.Extended)((fields, extend, options, publishedOnly, actorId) => sql`
  SELECT ${fields} FROM datasets
  ${extend|| sql`
  LEFT JOIN (
    SELECT "datasetId", COUNT(1) "entities", MAX("createdAt") "lastEntity", COUNT(1) FILTER (WHERE conflict IS NOT NULL) "conflicts"
    FROM entities e
    WHERE "deletedAt" IS NULL
    GROUP BY "datasetId"
  ) stats on stats."datasetId" = datasets.id`}
  ${(actorId == null) ? sql`` : sql`
  INNER JOIN
    (select id, array_agg(distinct verb) as verbs from projects
      inner join
        (select "acteeId", jsonb_array_elements_text(role.verbs) as verb from assignments
          inner join roles as role
            on role.id=assignments."roleId"
          where "actorId"=${actorId}) as assignment
        on assignment."acteeId" in ('*', 'project', projects."acteeId")
      group by id
      having array_agg(distinct verb) @> array['project.read', 'dataset.list']
    ) as filtered
  on filtered.id=datasets."projectId"
  `}
  WHERE ${sqlEquals(options.condition)}
    ${publishedOnly ? sql`AND "publishedAt" IS NOT NULL` : sql``}
  ORDER BY name ASC
`);

const getAllByAuth = (auth, options = QueryOptions.none) => ({ all }) =>
  _get(all, options, true, auth.actor.map((actor) => actor.id).orElse(-1));

// Get all published datasets for a specific project.
const getList = (projectId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ projectId }), true);

// Get a dataset by it's project id and name. Commonly used in a resource.
const get = (projectId, name, publishedOnly, extended = false) => ({ maybeOne }) => {
  const options = extended ? QueryOptions.extended : QueryOptions.none;
  return _get(maybeOne, options.withCondition({ projectId, name }), publishedOnly);
};

// Get by dataset ID - return only published dataset
const getById = (id, extended = false) => ({ maybeOne }) => {
  const options = extended ? QueryOptions.extended : QueryOptions.none;
  return _get(maybeOne, options.withCondition({ id }), true);
};

// Get by Actee ID - return only published dataset
const getByActeeId = (acteeId, extended = false) => ({ maybeOne }) => {
  const options = extended ? QueryOptions.extended : QueryOptions.none;
  return _get(maybeOne, options.withCondition({ acteeId }), true);
};

// Get any dataset with a similar name (but not exact match)
// Returns published dataset first.
const getPublishedBySimilarName = (projectId, name) => ({ maybeOne }) => {
  const _unjoiner = unjoiner(Dataset);
  return maybeOne(sql`SELECT ${_unjoiner.fields} FROM datasets
    WHERE LOWER(name) = LOWER(${name})
      AND name != ${name}
      AND "publishedAt" IS NOT NULL
      AND "projectId" = ${projectId}
    LIMIT 1`)
    .then(map(_unjoiner));
};

////////////////////////////////////////////////////////////////////////////////
// DATASET METADATA GETTERS

const _getLinkedForms = (datasetName, projectId) => sql`
SELECT DISTINCT f."xmlFormId", coalesce(current_def.name, f."xmlFormId") "name" FROM form_attachments fa
JOIN form_defs fd ON fd.id = fa."formDefId" AND fd."publishedAt" IS NOT NULL
JOIN forms f ON f.id = fd."formId" AND f."deletedAt" IS NULL
JOIN form_defs current_def ON f."currentDefId" = current_def.id
JOIN datasets ds ON ds.id = fa."datasetId"
WHERE ds.name = ${datasetName}
  AND ds."projectId" = ${projectId}
  AND ds."publishedAt" IS NOT NULL
`;

// Gets the dataset information, properties (including which forms each property comes from),
// and which forms consume the dataset via CSV attachment.
const getMetadata = (dataset) => async ({ all, Datasets }) => {

  const _getSourceForms = (datasetName, projectId) => sql`
    SELECT DISTINCT f."xmlFormId", coalesce(fd.name, f."xmlFormId") "name" FROM datasets ds
    JOIN dataset_form_defs dfd ON ds.id = dfd."datasetId"    
    JOIN form_defs fd ON dfd."formDefId" = fd.id
    JOIN forms f ON fd.id = f."currentDefId"
    WHERE ds.name = ${datasetName}
      AND ds."projectId" = ${projectId}
      AND ds."publishedAt" IS NOT NULL
      AND f."deletedAt" IS NULL
  `;

  const properties = await Datasets.getProperties(dataset.id, true);
  const linkedForms = await all(_getLinkedForms(dataset.name, dataset.projectId));
  const sourceForms = await all(_getSourceForms(dataset.name, dataset.projectId));
  const lastUpdate = await Datasets.getLastUpdateTimestamp(dataset.id);

  const propertiesMap = new Map();
  for (const property of properties) {
    // put property in the map if not there yet
    if (!propertiesMap.has(property.name)) {
      propertiesMap.set(property.name, {
        name: property.name,
        publishedAt: property.publishedAt,
        odataName: sanitizeOdataIdentifier(property.name),
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
    lastUpdate,
    linkedForms,
    sourceForms,
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
  LEFT OUTER JOIN form_defs fd ON
      fd.id = ds_property_fields."formDefId"
  LEFT OUTER JOIN form_fields ON
      ds_property_fields.path = form_fields.path
      AND form_fields."schemaId" = fd."schemaId"
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
    : uniqWith(equals, rows).map(construct(Dataset.Property))));

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
  ds_property_fields."formDefId" = form_defs."id"
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

// This helper function gets just the properties specificed by the saveto binds
// in a single form definition. It orders the properties by their question order
// within the form.
const _getFormSpecificProperties = (projectId, xmlFormId, forDraft) => sql`
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
      dp."publishedAt" IS NULL "isNew",
      ff.order "formFieldOrder"
    FROM ds_properties dp 
    JOIN ds ON ds.id = dp."datasetId"
    LEFT JOIN ds_property_fields dpf ON dpf."dsPropertyId" = dp.id
    JOIN form f ON dpf."formDefId" = f."formDefId"
    JOIN form_fields ff ON f."schemaId" = ff."schemaId"
      AND dpf."path" = ff."path"
  )
  SELECT ds.name "datasetName", ds.id "datasetId", ds."isNew" "isDatasetNew", p.name "propertyName", p."isNew" "isPropertyNew"
  FROM ds
  LEFT JOIN properties p on ds.id = p."datasetId"
  ${forDraft ? sql`` : sql`WHERE p.id IS NULL OR NOT p."isNew"`}
  ORDER BY ds.id ASC, p."formFieldOrder" ASC
`;

const getDiff = (projectId, xmlFormId, forDraft) => async ({ all, Datasets }) => {
  // This fetches all the dataset properties described in a specific form def/version, the one
  // the diff is about. The diff can be used for a draft def or the latest current def.
  // There may be multiple datasets in a form (though not technically possible as of july 2023)
  // so properties are grouped by their dataset, under a key: 'datasetName,datasetId,isDatasetNew'
  const propsByDataset = await all(_getFormSpecificProperties(projectId, xmlFormId, forDraft))
    .then(reduceBy((acc, { propertyName, isPropertyNew }) =>
      (propertyName ? acc.concat({ name: propertyName, isNew: forDraft ? isPropertyNew : undefined, inForm: true }) : acc),
    [],
    (row) => `${row.datasetName},${row.datasetId},${row.isDatasetNew}`));

  // This loops through each of the found datasets above, asks the database for _all_ the published properties
  // of that dataset, and then combines the inForm properties with the remaining dataset properties
  // in a clean way (i.e. properties NOT in the form, but already published in the dataset will be returned
  // at the beginning of the list in their correct order.
  const funcPerDataset = Object.keys(propsByDataset).map((k) => Datasets.getProperties(k.split(',')[1])
    .then((publishedProps) => {
      const formPropSet = propsByDataset[k].map(({ name }) => name);
      const allProps = publishedProps.reduce((acc, { name }) => (!formPropSet.includes(name) ? acc.concat({ name, isNew: forDraft ? false : undefined, inForm: false }) : acc), []).concat(propsByDataset[k]);
      return {
        name: k.split(',')[0],
        isNew: forDraft ? k.split(',')[2] === 'true' : undefined,
        properties: allProps
      };
    }));

  return Promise.all(funcPerDataset);
};

const update = (datasets, data) => ({ one }) => one(updater(datasets, data)).then(construct(Dataset));
update.audit = (datasets, data, autoConvert) => (log) => log('dataset.update', datasets, { data, autoConvert });

const _unprocessedSubmissions = (datasetId, fields) => sql`
SELECT ${fields} FROM dataset_form_defs dfd
JOIN submission_defs sd ON sd."formDefId" = dfd."formDefId"
JOIN submissions s ON sd."submissionId" = s.id AND (NOT s.draft)
JOIN forms f ON s."formId" = f.id AND f."deletedAt" IS NULL
JOIN (
  SELECT DISTINCT ON ((details->'submissionId')::INTEGER) * FROM audits
  WHERE action IN ('submission.create', 'submission.update.version')
  ORDER BY (details->'submissionId')::INTEGER, id DESC
) audits ON (audits.details->'submissionId')::INTEGER = s.id
LEFT JOIN (
  entity_defs ed 
  JOIN entity_def_sources es ON es.id = ed."sourceId"
  JOIN entities e ON e.id =  ed."entityId" AND e."datasetId" = ${datasetId}
  JOIN submission_defs source_sub_defs ON es."submissionDefId" = source_sub_defs.id
) ON source_sub_defs."submissionId" = s.id
LEFT JOIN (
  SELECT DISTINCT ON ((details->'submissionDefId')::INTEGER) * FROM audits
  WHERE action = 'entity.error'
) errors ON (errors.details->'submissionDefId')::INTEGER = sd.id
WHERE sd.current AND dfd."datasetId" = ${datasetId}
AND (s."reviewState" IS NULL OR s."reviewState" = 'edited' OR s."reviewState" = 'hasIssues')
AND ed.id IS NULL
AND errors.action IS NULL
`;

const countUnprocessedSubmissions = (datasetId) => ({ oneFirst }) => oneFirst(_unprocessedSubmissions(datasetId, sql`COUNT(1)`));

const getUnprocessedSubmissions = (datasetId) => ({ all }) =>
  all(_unprocessedSubmissions(datasetId, sql`audits.*`))
    .then(map(construct(Audit)));

// To return lastUpdate field for `GET /datasets/:name`
// Similar query is in form-attachments.js, if the logic lastUpdateTimestamp is changed here then it
// probably needs to be changed there.
const getLastUpdateTimestamp = (datasetId) => ({ maybeOne }) =>
  maybeOne(sql`
  SELECT "loggedAt" FROM audits
  JOIN datasets ON audits."acteeId" = datasets."acteeId"
  WHERE datasets."id"=${datasetId}
  ORDER BY audits."loggedAt" DESC LIMIT 1`)
    .then((t) => t.orNull())
    .then((t) => (t ? t.loggedAt : null));


const canReadForOpenRosa = (auth, datasetName, projectId) => ({ oneFirst }) => oneFirst(sql`
      WITH linked_forms AS (
        ${_getLinkedForms(datasetName, projectId)}
      )
      SELECT count(1) FROM linked_forms
      INNER JOIN (
        SELECT forms."xmlFormId" FROM forms
        INNER JOIN projects ON projects.id=forms."projectId"
        INNER JOIN (
          SELECT "acteeId" FROM assignments
          INNER JOIN (
            SELECT id FROM roles WHERE verbs ? 'form.read' OR verbs ? 'open_form.read'
          ) AS role ON role.id=assignments."roleId"
          WHERE "actorId"=${auth.actor.map((actor) => actor.id).orElse(-1)}
        ) AS assignment ON assignment."acteeId" IN ('*', 'form', projects."acteeId", forms."acteeId")
        WHERE forms.state != 'closed'
        GROUP BY forms."xmlFormId"
      ) AS users_forms ON users_forms."xmlFormId" = linked_forms."xmlFormId"
    `)
  .then(count => count > 0);

module.exports = {
  createPublishedDataset, createPublishedProperty,
  createOrMerge, publishIfExists,
  getList, get, getById, getByActeeId,
  getPublishedBySimilarName,
  getMetadata, getAllByAuth,
  getProperties, getFieldsByFormDefId,
  getDiff, update, countUnprocessedSubmissions,
  getUnprocessedSubmissions,
  getLastUpdateTimestamp, canReadForOpenRosa
};
