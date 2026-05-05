const up = async (db) => {
  await db.raw(``);

  // -- Registry of property names that can be assigned to actors, scoped per project.
  await db.raw(`
  CREATE TABLE actor_properties (
    id integer NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "projectId" integer NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    "name" text NOT NULL CHECK (length("name") > 0)
  )`);

  await db.raw(`CREATE UNIQUE INDEX ON actor_properties ("projectId", "name")`);

  // -- Values of actor properties
  await db.raw(`
  CREATE TABLE actor_property_values (
    id integer GENERATED ALWAYS AS IDENTITY,
    "actorId" integer NOT NULL REFERENCES field_keys ("actorId") ON DELETE CASCADE,  -- FK to field_keys for now; can be widened to actors if needed.
    "actorPropertyId" integer NOT NULL REFERENCES actor_properties (id) ON DELETE CASCADE,
    "value" text NOT NULL CHECK (length("value") > 0)
  )`);

  // -- Each actor can only have one value per property. Multivalued properties were intentionally avoided
  // -- to keep filtering semantics simple (no conjunction/disjunction complexity).
  // -- This index also serves as the index for the FK referent side (used when CASCADE-ing).
  await db.raw(`CREATE UNIQUE INDEX ON actor_property_values ("actorId", "actorPropertyId")`);

  // -- Index to support FK lookup on actorPropertyId (CASCADE deletes from actor_properties).
  await db.raw(`CREATE INDEX ON actor_property_values ("actorPropertyId")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE actor_property_values CASCADE');
  await db.raw('DROP TABLE actor_properties CASCADE');
};

module.exports = { up, down };
