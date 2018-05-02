const up = (knex) =>
  knex.schema.table('config', (config) => { config.dateTime('setAt'); });

const down = (knex) =>
  knex.schema.table('config', (config) => { config.dropColumn('setAt'); });

module.exports = { up, down };

