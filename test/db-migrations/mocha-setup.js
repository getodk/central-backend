const _log = level => (...args) => console.log(level, ...args);
global.log = _log('[INFO]');

global.assert = require('node:assert');
const fs = require('node:fs');
const slonik = require('slonik');
const migrator = require('./migrator');

async function mochaGlobalSetup() {
  log('mochaGlobalSetup() :: ENTRY');

  global.assert = assert;

  global.sql = slonik.sql;

  const { user, password, host, database } = jsonFile('./config/db-migration-test.json').default.database;
  const dbUrl = `postgres://${user}:${password}@${host}/${database}`;
  log('dbUrl:', dbUrl);
  global.db = slonik.createPool(dbUrl);

  const existingTables = await db.oneFirst(sql`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`);
  if(existingTables) {
    console.log(`
    Existing tables were found in the public database schema.  Reset the database before running migration tests.

    If you are using odk-postgres14 docker, try:

      docker exec odk-postgres14 psql -U postgres ${database} -c "
        DROP SCHEMA public CASCADE;
        CREATE SCHEMA public;
        GRANT ALL ON SCHEMA public TO postgres;
        GRANT ALL ON SCHEMA public TO public;
      "
    `);
    process.exit(1);
  }

  log('mochaGlobalSetup() :: EXIT');
}

function mochaGlobalTeardown() {
  log('mochaGlobalTeardown() :: ENTRY');
  db?.end();
  migrator.restoreMigrations();
  log('mochaGlobalTeardown() :: EXIT');
}

module.exports = { mochaGlobalSetup, mochaGlobalTeardown };

function jsonFile(path) {
  return JSON.parse(fs.readFileSync(path, { encoding:'utf8' }));
}
