const up = (knex, Promise) => Promise.all([
  knex.raw('alter table actors drop constraint actors_type_check'),
  knex.schema.table('actors', (actors) => actors.string('type', 15).alter())
]);

const down = (knex, Promise) => Promise.all([]);

module.exports = { up, down };

