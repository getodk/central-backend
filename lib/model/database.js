// This is a variety of functions helpful for connecting to and performing
// top-level operations with a database, like migrations.

const knex = require('knex');

// Connects to the postgres database specified in configuration and returns it.
const connect = (connectionSettings) => knex({ client: 'pg', connection: connectionSettings });

// Connects to a database, passes it to a function for operations, then ensures its closure.
const withDatabase = (connectionSettings) => (mutator) => {
  const db = connect(connectionSettings);
  return mutator(db).finally(() => db.destroy());
};

// Given a database, initiates migrations on it.
const migrate = (db) => db.migrate.latest({ directory: `${__dirname}/migrations` });

module.exports = { connect, withDatabase, migrate };

