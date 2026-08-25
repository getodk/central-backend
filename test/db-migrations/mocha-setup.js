const _log = level => (...args) => console.log(level, ...args); // eslint-disable-line no-console
global.log = _log('[INFO]');

const fs = require('node:fs');
const slonik = require('slonik');
const migrator = require('./migrator');

async function mochaGlobalSetup() {
  log('mochaGlobalSetup() :: ENTRY');

  global.sql = slonik.sql;

  const { user, password, host, database } = jsonFile('./config/db-migration-test.json').default.database; // eslint-disable-line no-use-before-define
  const dbUrl = `postgres://${user}:${password}@${host}/${database}`;
  log('dbUrl:', dbUrl);
  global.db = slonik.createPool(dbUrl);

  // Try to clean up the test database.  This should work unless you've used
  // different users to create/configure the DB.
  await db.query(sql`DROP OWNED BY CURRENT_USER`);

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
  return JSON.parse(fs.readFileSync(path, { encoding: 'utf8' }));
}
