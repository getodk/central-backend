const up = (db) => db.schema
  .raw('create extension if not exists CITEXT')
  .alterTable('users', (users) => users.specificType('email', 'CITEXT').notNullable().alter());

const down = (db) => db
  .alterTable('users', (users) => users.string('email', 320).notNullable().alter());

module.exports = { up, down };

