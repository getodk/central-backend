const up = (knex) =>
  knex.schema.createTable('forms', (forms) => {
    forms.increments('id');
    forms.string('xmlFormId', 64).notNull();
    forms.text('xml').notNull();
    forms.dateTime('createdAt');
    forms.dateTime('updatedAt');
    forms.dateTime('deletedAt');

    forms.index('xmlFormId');
    forms.unique('xmlFormId');
  }).then(() =>
    knex.schema.createTable('submissions', (submissions) => {
      submissions.increments('id');
      submissions.integer('formId').notNull();
      submissions.string('instanceId', 64).notNull();
      submissions.text('xml').notNull();
      submissions.dateTime('createdAt');
      submissions.dateTime('updatedAt');
      submissions.dateTime('deletedAt');

      submissions.index('formId');
      submissions.foreign('formId').references('forms.id');
      submissions.index(['formId', 'instanceId']);
    }));

const down = (knex) =>
  knex.schema.dropTable('submissions').then(() => knex.schema.dropTable('forms'));

module.exports = { up, down };

