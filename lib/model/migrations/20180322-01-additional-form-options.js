const up = (knex) =>
  knex.schema.table('forms', (forms) => {
    forms.text('state').defaultTo('open');
    forms.index([ 'deletedAt', 'state' ]);
  }).then(() => knex('forms').update({ state: 'open' }));

const down = (knex) =>
  knex.schema.table('forms', (forms) => {
    forms.dropColumn('state');
  });

module.exports = { up, down };

