module.exports = {
  runBefore,
  runIncluding,
};

const fs = require('node:fs');
const { execSync } = require('node:child_process');
const _ = require('lodash');

const migrationsDir = './lib/model/migrations';
const allMigrations = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''))
    .sort(); // TODO check that this is how knex sorts migration files

log();
log('allMigrations:');
log();
allMigrations.forEach(m => log('*', m));
log();
log('Total:', allMigrations.length);
log();

function runBefore(migrationName) {
  const idx = allMigrations.indexOf(migrationName);

  log('runBefore()', migrationName, 'found at', idx);

  if(idx === -1) throw new Error(`Unknown migration: ${migrationName}`);

  if(idx === 0) return;

  const previousMigration = allMigrations[idx - 1];

  log('previousMigration:', previousMigration);

  return runIncluding(previousMigration);
}

function runIncluding(lastMigrationToRun) {
  const env = { ..._.pick(process.env, 'PATH', 'NODE_CONFIG_ENV') };
  const res = execSync(`node ./lib/bin/run-migrations.js ${lastMigrationToRun}`, { env, encoding:'utf8' });
  log(`Ran migrations up-to-and-including ${lastMigrationToRun}:\n`, res);
};
