const up = (knex) =>
  knex.schema.table('forms', (forms) => {
    forms.string('acteeId', 36).notNull();
    forms.foreign('acteeId').references('actees.id');
  });

const down = (knex) =>
  knex.schema.table('forms', (forms) => forms.dropColumn('acteeId'));

module.exports = { up, down };

