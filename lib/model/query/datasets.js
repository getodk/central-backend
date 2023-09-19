// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { extender, QueryOptions, equals, updater } = require('../../util/db');
const { Dataset, Form, Audit } = require('../frames');
const { validatePropertyName } = require('../../data/dataset');
const { isEmpty, isNil, either, reduceBy, groupBy, uniqWith, equals: rEquals, map } = require('ramda');

const Problem = require('../../util/problem');
const { construct } = require('../../util/util');
const { sanitizeOdataIdentifier } = require('../../util/util');

////////////////////////////////////////////////////////////////////////////
// DATASET CREATE AND UPDATE

const _insertDatasetDef = (dataset, acteeId) => sql`
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
    SELECT ds.id, ${dataset.aux.formDefId} FROM ds
    ON CONFLICT ON CONSTRAINT dataset_form_defs_datasetid_formdefid_unique 
    DO NOTHING
  )
`;

const _insertProperties = (fields) => sql`
,fields("propertyName", "formDefId", "schemaId", path) AS (VALUES      
  ${sql.join(fields.map(p => sql`( ${sql.join([p.aux.propertyName, p.aux.formDefId, p.schemaId, p.path], sql`,`)} )`), sql`,`)}
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

const _createOrMerge = (dataset, fields, acteeId) => sql`
${_insertDatasetDef(dataset, acteeId)}
${isNilOrEmpty(fields) ? sql`` : _insertProperties(fields)}
SELECT "action", "id" FROM ds
`;

// Takes the dataset name and field->property mappings defined in a form
// and creates or updates the named dataset.
// Arguments:
// * dataset name
// * form (a Form frame or object containing projectId, formDefId, and schemaId)
// * array of field objects and property names that were parsed from the form xml
const createOrMerge = (name, form, fields) => async ({ one, Actees, Datasets, Projects }) => {
  const { projectId } = form;
  const { id: formDefId, schemaId } = form.def;

  // Provision acteeId if necessary.
  // Need to check for existing dataset, and if not found, need to also
  // fetch the project since the dataset will be an actee child of the project.
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
  // Step 2: Check for invalid property names
  if (dsPropertyFields.filter((field) => !validatePropertyName(field.propertyName)).length > 0)
    throw Problem.user.invalidEntityForm({ reason: 'Invalid entity property name.' });
  // Step 3: Build Form Field frames to handle dataset property field insertion
  dsPropertyFields = dsPropertyFields.map((field) => new Form.Field(field, { propertyName: field.propertyName, schemaId, formDefId }));

  // Insert or update: update dataset, dataset properties, and links to fields and current form
  // result contains action (created or updated) and the id of the dataset.
  const result = await one(_createOrMerge(partial, dsPropertyFields, acteeId))
    .catch(error => {
      if (error.constraint === 'ds_property_fields_dspropertyid_formdefid_unique') {
        throw Problem.user.invalidEntityForm({ reason: 'Multiple Form Fields cannot be saved to a single property.' });
      }
      throw error;
    });

  // Partial contains acteeId which is needed for auditing.
  // Additional form fields and properties needed for audit logging as well.
  return partial.with({ action: result.action, fields: dsPropertyFields });
};

////////////////////////////////////////////////////////////////////////////
// DATASET (AND DATASET PROPERTY) PUBLISH

// Publishes the Dataset if it exists, noop if it doesn't.
// `IfExists` part is particularly helpful for `Forms.publish`,
// with that it doesn't need to ensure the existence of the Dataset
// and it can call this function blindly
const publishIfExists = (formDefId, publishedAt) => ({ all }) => all(sql`
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
`);

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
    SELECT "datasetId", COUNT(1) "entities", MAX(COALESCE("updatedAt", "createdAt")) "lastEntity"
    FROM entities e
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
  WHERE ${equals(options.condition)}
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
) ON es."submissionDefId" = sd.id
WHERE sd.current AND dfd."datasetId" = ${datasetId}
AND (s."reviewState" IS NULL OR s."reviewState" = 'edited' OR s."reviewState" = 'hasIssues')
AND ed.id IS NULL
`;

const countUnprocessedSubmissions = (datasetId) => ({ oneFirst }) => oneFirst(_unprocessedSubmissions(datasetId, sql`COUNT(1)`));

const getUnprocessedSubmissions = (datasetId) => ({ all }) =>
  all(_unprocessedSubmissions(datasetId, sql`audits.*`))
    .then(map(construct(Audit)));

module.exports = {
  createOrMerge, publishIfExists,
  getList, get, getById, getByActeeId,
  getMetadata, getAllByAuth,
  getProperties, getFieldsByFormDefId,
  getDiff, update, countUnprocessedSubmissions,
  getUnprocessedSubmissions
};
