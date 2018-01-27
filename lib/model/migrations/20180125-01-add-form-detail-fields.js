const up = (knex) =>
  knex.schema.table('forms', (forms) => {
    forms.text('name');
    forms.text('version');
    forms.text('hash');
  });

const down = (knex) =>
  knex.schema.table('forms', (forms) => {
    forms.dropColumn('name');
    forms.dropColumn('version');
    forms.dropColumn('hash');
  });

module.exports = { up, down };

