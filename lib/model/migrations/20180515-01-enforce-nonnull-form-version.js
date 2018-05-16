
const up = (knex) =>
  knex.raw('update forms set version=\'\' where version is null;')
    .then(() => knex.schema.table('forms', (forms) => forms.text('version').notNullable().alter()));

const down = (knex) =>
  knex.schema.table('forms', (forms) => forms.text('version').nullable().alter());

module.exports = { up, down };

