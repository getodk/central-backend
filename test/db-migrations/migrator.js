// This functions by moving migration files in and out of the migrations target
// directory.
//
// Aims:
//
// * ensure that the real production migration command is run in tests
// * avoid isolation differences between running the tests & migrations in the
//   same node instance.  These differences might include shared globals,
//   database connection pool state, database transaction states etc.
// * ensure that these tests do not depend directly on knex.  Removing knex
//   dependency is a long-term project goal.
// * allow replacement of the production migration implementation without
//   changing tests

const fs = require('node:fs');
const { execSync } = require('node:child_process');

const legacy   = createMigrator('Legacy',    './lib/model/migrations',           './test/db-migrations/.holding-pen/legacy');            // eslint-disable-line no-use-before-define, no-multi-spaces
const postKnex = createMigrator('Post-knex', './lib/model/migrations-post-knex', './test/db-migrations/.holding-pen/post-knex', legacy); // eslint-disable-line no-use-before-define

module.exports = { legacy, postKnex };

function createMigrator(name, migrationsDir, holdingPen, previousMigrator) {
  fs.mkdirSync(holdingPen, { recursive: true });

  restoreMigrations(); // eslint-disable-line no-use-before-define
  const allMigrations = loadMigrationsList(); // eslint-disable-line no-use-before-define
  moveMigrationsToHoldingPen(); // eslint-disable-line no-use-before-define

  let lastRunIdx = -1;

  return {
    exists,            // eslint-disable-line no-use-before-define, no-multi-spaces
    hasRun,            // eslint-disable-line no-use-before-define, no-multi-spaces
    runBefore,         // eslint-disable-line no-use-before-define, no-multi-spaces
    runIncluding,      // eslint-disable-line no-use-before-define, no-multi-spaces
    restoreMigrations, // eslint-disable-line no-use-before-define
  };

  function runBefore(migrationName) {
    const idx = getIndex(migrationName); // eslint-disable-line no-use-before-define
    runUntilIndex(idx - 1);
  }

  function runIncluding(lastMigrationToRun) {
    runUntilIndex(getIndex(lastMigrationToRun)); // eslint-disable-line no-use-before-define
  }

  function runUntilIndex(finalIdx) {
    for (let restoreIdx=lastRunIdx+1; restoreIdx<=finalIdx; ++restoreIdx) { // eslint-disable-line no-plusplus
      const f = allMigrations[restoreIdx] + '.js';
      fs.renameSync(`${holdingPen}/${f}`, `${migrationsDir}/${f}`);
    }

    if (previousMigrator) {
      log('Restoring migrations for previousMigrator...');
      previousMigrator.restoreMigrations();
    }

    const lastMigrationToRun = allMigrations[finalIdx];
    log('Running migrations until:', lastMigrationToRun, '...');
    const res = execSync(`node ./lib/bin/run-migrations.js`, { encoding: 'utf8' });

    lastRunIdx = finalIdx;

    log(`Ran migrations up-to-and-including ${lastMigrationToRun}:\n`, res);
  }

  function getIndex(migrationName) {
    const idx = allMigrations.indexOf(migrationName);
    log('getIndex()', migrationName, 'found at', idx);
    if (idx === -1) throw new Error(`Unknown migration: ${migrationName}`);
    return idx;
  }

  function restoreMigrations() {
    moveAll(holdingPen, migrationsDir); // eslint-disable-line no-use-before-define
  }

  function moveMigrationsToHoldingPen() {
    moveAll(migrationsDir, holdingPen); // eslint-disable-line no-use-before-define
  }

  function moveAll(src, tgt) {
    fs.readdirSync(src)
      .filter(f => f.endsWith('.js'))
      .forEach(f => fs.renameSync(`${src}/${f}`, `${tgt}/${f}`));
  }

  function loadMigrationsList() {
    const migrations = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.js'))
      .map(f => f.replace(/\.js$/, ''))
      .sort(); // TODO check that this is how knex sorts migration files
    log();
    log(`${name} migrations:`);
    log();
    migrations.forEach(m => log('*', m));
    log();
    log('Total:', migrations.length);
    log();
    return migrations;
  }

  function exists(migrationName) {
    try {
      getIndex(migrationName);
      return true;
    } catch (err) {
      return false;
    }
  }

  function hasRun(migrationName) {
    return lastRunIdx >= getIndex(migrationName);
  }
}
