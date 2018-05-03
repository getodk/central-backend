// we should be using dateTime rather than date. this fixes that:

const up = (knex) =>
  knex.schema.table('actors', (actors) => actors.dateTime('expiresAt').alter());

const down = (knex) =>
  knex.schema.table('actors', (actors) => actors.date('expiresAt').alter());

module.exports = { up, down };

