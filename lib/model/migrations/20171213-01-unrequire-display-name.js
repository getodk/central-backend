const up = (knex) =>
  knex.schema.table('actors', (actors) => actors.string('displayName', 64).nullable().alter());

const down = (knex) =>
  knex.schema.table('actors', (actors) => actors.string('displayName', 64).notNullable().alter());

module.exports = { up, down };

