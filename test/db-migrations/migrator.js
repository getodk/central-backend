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

module.exports = {
  exists,
  hasRun,
  runBefore,
  runIncluding,
  restoreMigrations,
};

const fs = require('node:fs');
const { execSync } = require('node:child_process');

const migrationsDir = './lib/model/migrations';
const holdingPen = './test/db-migrations/.holding-pen';

fs.mkdirSync(holdingPen, { recursive: true });

restoreMigrations();
const allMigrations = loadMigrationsList();
moveMigrationsToHoldingPen();

let lastRunIdx = -1;

function runBefore(migrationName) {
  const idx = getIndex(migrationName);
  if (idx === 0) return;

  const previousMigration = allMigrations[idx - 1];

  return runIncluding(previousMigration);
}

function runIncluding(lastMigrationToRun) {
  const finalIdx = getIndex(lastMigrationToRun);

  for (let restoreIdx=lastRunIdx+1; restoreIdx<=finalIdx; ++restoreIdx) { // eslint-disable-line no-plusplus
    const f = allMigrations[restoreIdx] + '.js';
    fs.renameSync(`${holdingPen}/${f}`, `${migrationsDir}/${f}`);
  }

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
  moveAll(holdingPen, migrationsDir);
}

function moveMigrationsToHoldingPen() {
  moveAll(migrationsDir, holdingPen);
}

function moveAll(src, tgt) {
  fs.readdirSync(src)
    .forEach(f => fs.renameSync(`${src}/${f}`, `${tgt}/${f}`));
}

function loadMigrationsList() {
  const migrations = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''))
    .sort(); // TODO check that this is how knex sorts migration files
  log();
  log('All migrations:');
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
