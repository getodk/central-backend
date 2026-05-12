const { sql } = require('slonik');
const { map } = require('ramda');
const { ActorProperty } = require('../frames');
const { construct } = require('../../util/util');
const { getOrNotFound } = require('../../util/promise');


// Creates a new actor property name for a project.
const create = (projectId, name) => ({ one }) =>
  one(sql`
INSERT INTO actor_properties ("projectId", "name")
VALUES (${projectId}, ${name})
RETURNING *`)
    .then(construct(ActorProperty));

// Returns all actor property names for a project.
const getAllForProject = (projectId) => ({ all }) =>
  all(sql`
SELECT * FROM actor_properties
WHERE "projectId" = ${projectId}
ORDER BY "name"`)
    .then(map(construct(ActorProperty)));

// Returns all actor property names for a project, each with an array of distinct
// values currently in use across all actors.
const getAllForProjectWithValues = (projectId) => ({ all }) =>
  all(sql`
SELECT ap.*, coalesce(
  array_agg(DISTINCT apv.value ORDER BY apv.value) FILTER (WHERE apv.value IS NOT NULL),
  '{}'
) AS values
FROM actor_properties ap
LEFT JOIN actor_property_values apv ON apv."actorPropertyId" = ap.id
WHERE ap."projectId" = ${projectId}
GROUP BY ap.id
ORDER BY ap.name`)
    .then(map((row) => ({ name: row.name, values: row.values })));

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

module.exports = { create, getAllForProject, getAllForProjectWithValues, setValueForActor };

