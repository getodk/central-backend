const up = (knex) =>
  knex.schema.table('submissions', (submissions) => {
    submissions.integer('submitter');
    submissions.foreign('submitter').references('actors.id');
  });

const down = (knex) =>
  knex.schema.table('submissions', (submissions) =>
    submissions.dropColumn('submitter'));

module.exports = { up, down };


