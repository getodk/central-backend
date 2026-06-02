const { sql } = require('slonik');
const { map } = require('ramda');
const { ActorProperty } = require('../frames');
const { construct } = require('../../util/util');


// Creates a new actor property name for a project.
const create = (project, name) => ({ one }) =>
  one(sql`
INSERT INTO actor_properties ("projectId", "name")
VALUES (${project.id}, ${name})
RETURNING *`)
    .then(construct(ActorProperty));

create.audit = (project, name) => (log) => log('actor_property.create', project, { name });

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

// Sets or unsets multiple property values for an actor in two bulk queries:
// one to delete rows for null-valued properties, one to upsert non-null ones.
// properties is a plain object mapping property names to values (string or null),
// as returned by extractActorProperties() in lib/data/actor-properties.js.
const setValuesForActor = (projectId, fieldKeyOrLink, properties) => async ({ run }) => {
  const entries = Object.entries(properties);
  const toDelete = entries.filter(([, v]) => v === null).map(([name]) => name);
  const toUpsert = entries.filter(([, v]) => v !== null);

  if (toDelete.length > 0) {
    await run(sql`
DELETE FROM actor_property_values
WHERE "actorId" = ${fieldKeyOrLink.actorId}
  AND "actorPropertyId" IN (
    SELECT id FROM actor_properties
    WHERE "projectId" = ${projectId} AND name = ANY(${sql.array(toDelete, 'text')})
  )`);
  }

  if (toUpsert.length > 0) {
    await run(sql`
INSERT INTO actor_property_values ("actorId", "actorPropertyId", "value")
SELECT ${fieldKeyOrLink.actorId}, ap.id, v.value
FROM ${sql.unnest(toUpsert, ['text', 'text'])} AS v(name, value)
JOIN actor_properties ap ON ap."projectId" = ${projectId} AND ap.name = v.name
ON CONFLICT ("actorId", "actorPropertyId") DO UPDATE SET "value" = EXCLUDED."value"`);
  }
};

setValuesForActor.audit = (_, fieldKeyOrLink, properties) => (log) => {
  if (Object.keys(properties).length > 0) {
    // Look up `public_link` or `field_key` type from fieldKeyOrLink
    const action = `${fieldKeyOrLink.constructor.actorType}.property.set`;
    return log(action, fieldKeyOrLink.actor, { properties });
  }
};

module.exports = { create, getAllForProject, getAllForProjectWithValues, setValuesForActor };

