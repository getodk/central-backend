const { sql } = require('slonik');
const { ActorProperty, DatasetAccessFilter } = require('../frames');
const { getOrNotFound } = require('../../util/promise');

// Registers a new actor property name for a project.
const create = (projectId, name) => ({ one }) =>
  one(sql`
INSERT INTO actor_properties ("projectId", "name")
VALUES (${projectId}, ${name})
RETURNING *`)
    .then((row) => new ActorProperty(row));

// Returns all actor property names for a project.
const getAllForProject = (projectId) => ({ all }) =>
  all(sql`
SELECT * FROM actor_properties
WHERE "projectId" = ${projectId}
ORDER BY "name"`)
    .then((rows) => rows.map((row) => new ActorProperty(row)));

// Sets or unsets a property value for an app user (actorId).
// Pass value=null to unset the property (removes the value row).
// The property must exist in actor_properties for the project.
const setValueForActor = (projectId, actorId, name, value) => async ({ run, maybeOne }) => {
  const property = await maybeOne(sql`
SELECT id FROM actor_properties
WHERE "projectId" = ${projectId} AND "name" = ${name}`).then(getOrNotFound);

  if (value == null) {
    await run(sql`
DELETE FROM actor_property_values
WHERE "actorId" = ${actorId} AND "actorPropertyId" = ${property.id}`);
  } else {
    await run(sql`
INSERT INTO actor_property_values ("actorId", "actorPropertyId", "value")
VALUES (${actorId}, ${property.id}, ${value})
ON CONFLICT ("actorId", "actorPropertyId") DO UPDATE SET "value" = EXCLUDED."value"`);
  }
};

// Returns all property values for an app user as { name, value } rows.
const getValuesForActor = (actorId) => ({ all }) =>
  all(sql`
SELECT ap."name", apv."value"
FROM actor_property_values apv
JOIN actor_properties ap ON ap.id = apv."actorPropertyId"
WHERE apv."actorId" = ${actorId}
ORDER BY ap."name"`);

// Adds or updates a single access filter rule for a dataset.
// datasetPropertyName and userPropertyName are names (strings).
const setAccessFilter = (datasetId, datasetPropertyName, userPropertyName) => async ({ run, maybeOne }) => {
  const dsProp = await maybeOne(sql`
SELECT id FROM ds_properties WHERE "datasetId" = ${datasetId} AND "name" = ${datasetPropertyName} AND "publishedAt" IS NOT NULL`).then(getOrNotFound);

  const actorProp = await maybeOne(sql`
SELECT ap.id FROM actor_properties ap
JOIN datasets d ON d."projectId" = ap."projectId"
WHERE d.id = ${datasetId} AND ap."name" = ${userPropertyName}`).then(getOrNotFound);

  await run(sql`
INSERT INTO dataset_access_filters ("datasetId", "datasetPropertyId", "actorPropertyId")
VALUES (${datasetId}, ${dsProp.id}, ${actorProp.id})
ON CONFLICT ("datasetPropertyId") DO UPDATE SET "actorPropertyId" = EXCLUDED."actorPropertyId"`);
};

// Returns all access filter rules for a dataset as DatasetAccessFilter instances.
const getAccessFilter = (datasetId) => ({ all }) =>
  all(sql`
SELECT dsp."name" AS "datasetProperty", ap."name" AS "userProperty"
FROM dataset_access_filters daf
JOIN ds_properties dsp ON dsp.id = daf."datasetPropertyId"
JOIN actor_properties ap ON ap.id = daf."actorPropertyId"
WHERE daf."datasetId" = ${datasetId}
ORDER BY dsp."name"`)
    .then((rows) => rows.map((row) => new DatasetAccessFilter(row)));

module.exports = { create, getAllForProject, setValueForActor, getValuesForActor, setAccessFilter, getAccessFilter };
