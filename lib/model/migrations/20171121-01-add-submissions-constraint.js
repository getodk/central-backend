const up = (knex) =>
  knex.schema.table('submissions', (submissions) =>
    submissions.unique([ 'formId', 'instanceId' ]));

const down = (knex) =>
  knex.schema.table('submissions', (submissions) =>
    submissions.dropUnique([ 'formId', 'instanceId' ]));

module.exports = { up, down };

