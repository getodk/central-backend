// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { lstatSync, readdirSync } = require('node:fs');

const _ = require('lodash'); // eslint-disable-line import/no-extraneous-dependencies
const pg = require('pg');

const migrationsDir = `${__dirname}/migrations`;

const validateName = name => {
  if (!name.match(/^\d{8}-\d{2}-[a-zA-Z0-9_-]+.js/)) {
    throw new Error(`Illegal name format for migration '${name}'`);
  }
};

const withPg = (config) => async fn => {
  const log = (...args) => console.log('[withPg]', ...args); // eslint-disable-line no-console
  log('ENTRY');

  const { Client } = pg;
  const client = new Client(config);

  log('client created');

  log('Connecting to client...');
  await client.connect();
  log('Client connected OK.');

  try {
    await fn(client);
  } finally {
    log('Ending client...');
    await client.end();
    log('Client ended.');
  }
};

const getMigrationsToRun = async client => {
  const log = (...args) => console.log('[getMigrationsToRun]', ...args); // eslint-disable-line no-console
  log('ENTRY');

  const allMigrations = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js') && lstatSync(`${migrationsDir}/${f}`).isFile())
    .sort(); // match sorting in knex/lib/migrate/sources/fs-migrations.js
  log('allMigrations:', allMigrations);

  const alreadyRun = (await client.query('SELECT name FROM knex_migrations')).rows.map(r => r.name);
  log('alreadyRun:', alreadyRun);

  const toRunNames = allMigrations.filter(m => !alreadyRun.includes(m));
  log('toRunNames:', toRunNames);

  const toRun = toRunNames.map(name => {
    const path = `${migrationsDir}/${name}`;
    const migration = require(path); // eslint-disable-line import/no-dynamic-require
    return { name, path, migration };
  });
  log('toRun:', toRun);

  return toRun;
};

// In the main, this migrator is written to behave similarly to knex's:
//
//   * uses existing knex_migrations and knex_migrations_lock tables
//   * expects transaction property async .up({ raw })
//   * provides implementation of db.raw()
//   * runs all new migrations in the same transaction
//
// Notable differences
//
//   * ONLY provides db.raw()-equivalent function to transactions - no knex query builder etc.
//   * ONLY implements up(); will throw if a transaction has other properties, except for `down()`.
//     To reverse a migration, run e.g.:
//         await require('./lib/model/pg-migrator')
//             .withPg(require('config').get('default.database'))(
//               require('./lib/model/migrations/20231208-01-dataset-form-def-actions').down,
//             )
//   * gets list of migrations to run _after_ acquiring db lock (knex checks before acquiring lock,
//     and then has to re-check afterwards)
//   * sets migration_time to be the start of the migration batch's transaction rather than some
//     other intermediate time
//   * instead of attempting to acquire a lock on the single row in the knex_migrations_lock table,
//     this code takes the simpler approach of locking the whole table.  This table could be
//     discarded completely by instead locking the knex_migrations table, but backwards-
//     compatibility is essential to prevent concurrent running of knex-based and pg-based
//     migrators.
//   * does not check that all migrations listed in the database table actually exist in the
//     filesystem
const migrate = async (client) => {
  const log = (...args) => console.log('[pgMigrations]', ...args); // eslint-disable-line no-console

  try {
    log('Starting transaction...');
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    log('Transaction started.');

    log('Creating tables if they do not exist...');
    // N.B. these tables are created to be similar to the legacy knex-created table.
    const nameMaxLen = 255;
    await client.query(`
      CREATE TABLE IF NOT EXISTS knex_migrations (
        id             SERIAL             PRIMARY KEY,
        name           VARCHAR(${nameMaxLen}) NOT NULL,
        batch          INTEGER,
        migration_time TIMESTAMP(3) WITH TIME ZONE
      );
      CREATE TABLE IF NOT EXISTS knex_migrations_lock (
        index     SERIAL  PRIMARY KEY,
        is_locked INTEGER NOT NULL
      );
    `);
    log('Tables now definitely exists.');

    log('Acquiring lock on knex_migrations_lock table...');
    await client.query('LOCK TABLE knex_migrations_lock IN EXCLUSIVE MODE NOWAIT');
    log('Lock acquired.');

    const toRun = await getMigrationsToRun(client);

    if (!toRun.length) {
      log('No migrations to run - exiting.');
      await client.query('ROLLBACK');
      return;
    }

    log('Validating', toRun.length, 'migrations...');
    for (const { migration, name } of toRun) {
      log('Validating migration:', name, '...');

      if (name.length > nameMaxLen) throw new Error(`Migration name '${name}' is too long - max length is ${nameMaxLen}, but got ${name.length}`);

      validateName(name);

      const keys = Object.keys(migration);
      const unexpectedKeys = _.omit(keys, 'up', 'down');
      if (unexpectedKeys.length) throw new Error(`Unexpected key(s) found in migration ${name}: ${unexpectedKeys}`);

      if (!migration.up) throw new Error(`Required prop .up not found in migration ${name}`);
      if (typeof migration.up !== 'function') {
        throw new Error(`Required prop .up of migration ${name} has incorrect type - expected 'function', but got '${typeof migration.up}'`);
      }

      if (migration.down && typeof migration.down !== 'function') {
        throw new Error(`Optional prop .down of migration ${name} has incorrect type - expected 'function' but got '${typeof migration.down}'`);
      }

      log('Migration', name, 'looks valid.');
    }
    log(toRun.length, 'migrations look valid.');

    log('Running', toRun.length, 'migrations...');
    const { lastBatch } = (await client.query(`SELECT COALESCE(MAX(batch), 0) AS "lastBatch" FROM knex_migrations`)).rows[0];
    const batchNumber = lastBatch + 1;
    log('  batch number:', batchNumber);

    /* eslint-disable no-await-in-loop */
    for (const { migration, name } of toRun) {
      log('Running migration:', name);
      await migration.up(client);
      // `CLOCK_TIMESTAMP()` used to match knex migrator's `new Date()`.
      await client.query(`
        INSERT INTO knex_migrations
          (name, batch, migration_time)
          VALUES($1, $2, CLOCK_TIMESTAMP())
      `, [ name, batchNumber ]);
      log('Migration complete:', name);
    }
    /* eslint-enable no-await-in-loop */
    log(toRun.length, 'migrations ran OK.');

    log('Committing migrations...');
    await client.query('COMMIT');
    log('Migrations committed.');
  } catch (err) {
    log('Caught error; rolling back', err);
    await client.query('ROLLBACK');
    throw err;
  }
};

module.exports = { withPg, migrate };
