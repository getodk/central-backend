const fs = require('node:fs');
const slonik = require('slonik');
const migrator = require('./migrator');

async function mochaGlobalSetup() {
  global.sql = slonik.sql;

  const { user, password, host, database } = jsonFile('./config/db-migration-test.json').default.database;
  const dbUrl = `postgres://${user}:${password}@${host}/${database}`;
  global.db = slonik.createPool(dbUrl);

  // Try to clean up the test database.  This should work unless you've used
  // different users to create/configure the DB.
  await db.query(sql`DROP OWNED BY CURRENT_USER`);
}

function mochaGlobalTeardown() {
  db?.end();
  migrator.restoreMigrations();
}

module.exports = { mochaGlobalSetup, mochaGlobalTeardown };

function jsonFile(path) {
  return JSON.parse(fs.readFileSync(path, { encoding:'utf8' }));
}
