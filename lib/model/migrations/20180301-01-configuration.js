const up = (knex, Promise) =>
  knex.schema.createTable('config', (config) => {
    config.string('key', 40).primary();
    config.text('value');
  }).then(() => {
    const { Actee } = require('../package').withDefaults({ db: knex });
    return (new Actee({ id: 'config', species: 'species' })).create().point();
  });

const down = (knex, Promise) =>
  knex.schema.dropTable('config');

module.exports = { up, down };

