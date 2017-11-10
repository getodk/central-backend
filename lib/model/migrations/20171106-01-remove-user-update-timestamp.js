const up = (knex) =>
  knex.schema.table('users', (users) => users.dropColumn('updatedAt'));

const down = (knex) =>
  knex.schema.table('users', (users) => users.dateTime('updatedAt'));

module.exports = { up, down };

