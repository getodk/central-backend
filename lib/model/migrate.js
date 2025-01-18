// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This is a variety of functions helpful for connecting to and performing
// top-level operations with a database, like migrations.

const { lstatSync, readdirSync } = require('node:fs');

const _ = require('lodash'); // eslint-disable-line import/no-extraneous-dependencies
const knex = require('knex');
const pg = require('pg');
const { knexConnection } = require('../util/db');

// Connects to the postgres database specified in configuration and returns it.
const knexConnect = (config) => knex({ client: 'pg', connection: knexConnection(config) });

const legacyPath = `${__dirname}/migrations`; // TODO rename to /migrations/legacy
const postKnexPath = `${__dirname}/migrations-post-knex`; // TODO rename to /migrations/current

// Connects to a database, passes it to a function for operations, then ensures its closure.
const withKnex = (config) => (mutator) => {
  const db = knexConnect(config);
  return mutator(db).finally(() => db.destroy());
};

// Given a database, initiates migrations on it.
const knexMigrations = (db) => db.migrate.latest({ directory: legacyPath });

const withPg = async (config, fn) => {
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

const getPostKnexMigrationsToRun = async client => {
  const log = (...args) => console.log('[getPostKnexMigrationsToRun]', ...args); // eslint-disable-line no-console
  log('ENTRY');

  const migrationsDir = postKnexPath;
  const allMigrations = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js') && lstatSync(`${migrationsDir}/${f}`).isFile())
    .sort();
  log('allMigrations:', allMigrations);

  const alreadyRun = (await client.query('SELECT name FROM post_knex_migrations')).rows.map(r => r.name);
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

const postKnexMigrations = async (config) => {
  const log = (...args) => console.log('[postKnexMigrations]', ...args); // eslint-disable-line no-console
  log('ENTRY');

  // In the main, this migrator is written to behave similarly to knex's:
  //
  //   * expects transaction property async .up({ raw })
  //   * provides implementation of db.raw()
  //   * runs all new migrations in the same transaction
  //
  // Notable differences
  //
  //   * uses new post_knex_migrations table
  //   * ONLY provides db.raw()-equivalent function to transactions - no knex query builder etc.
  //   * ONLY implements up(); will throw if a transaction has other properties, except for `down()` which is currently ignored TODO implement this if it's useful to devs
  //   * gets list of migrations to run _after_ acquiring db lock
  //   * sets migration_time to be the start of the migration batch's transaction rather than some other intermediate time

  await withPg(config, async client => {
    try {
      log('Starting transaction...');
      await client.query('BEGIN'); // TODO do we need a specific transaction type?
      log('Transaction started.');

      log('Acquiring knex lock...');
      // TODO do this... if it's useful.  Need to think of _some_ way to prevent new migrations and old migrations running simultaneously.
      log('Knex lock acquired');

      log('Creating new table if not exists...');
      // N.B. this table is created to be similar to the legacy knex-created table.
      // The key difference is that name, batch and migration_time columns are
      // not nullable.
      const maxLen = 255;
      await client.query(`
        CREATE TABLE IF NOT EXISTS post_knex_migrations (
          id             SERIAL                      PRIMARY KEY,
          name           VARCHAR(${maxLen})          NOT NULL,
          batch          INTEGER                     NOT NULL,
          migration_time TIMESTAMP(3) WITH TIME ZONE NOT NULL
      )`);
      log('Table now definitely exists.');

      log('Acquiring lock on post_knex_migrations table...');
      await client.query('LOCK TABLE post_knex_migrations IN EXCLUSIVE MODE NOWAIT');
      log('Lock acquired.');

      const toRun = await getPostKnexMigrationsToRun(client);

      if (!toRun.length) {
        log('No migrations to run - exiting.');
        await client.query('ROLLBACK');
        return;
      }

      log('Validating', toRun.length, 'migrations...');
      for (const { migration, name } of toRun) {
        log('Validing migration:', name, '...');

        if (name.length > maxLen) throw new Error(`Migration name '${name}' is too long - max length is ${maxLen}, but got ${name.length}`);

        // TODO check for illegal chars in name?

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
      for (const { migration, name } of toRun) {
        log('Running migration:', name);
        await migration.up(client); // eslint-disable-line no-await-in-loop
        log('Migration complete:', name);
      }
      log(toRun.length, 'migrations ran OK.');

      const { lastBatch } = (await client.query(`SELECT COALESCE(MAX(batch), 0) AS "lastBatch" FROM post_knex_migrations`)).rows[0];
      log('lastBatch:', lastBatch);

      // Note that migration_time is CLOCK_TIMESTAMP() to match knex implementation.
      // TODO confirm in relevant version of knex source code that this is actually the case, and link here.
      const namesJson = JSON.stringify(toRun.map(m => m.name));
      // See: https://www.postgresql.org/docs/current/functions-json.html
      await client.query(`
        INSERT INTO post_knex_migrations(name, batch, migration_time)
          SELECT value#>>'{}' AS name
               , ${lastBatch + 1} AS batch
               , CLOCK_TIMESTAMP() AS migration_time
            FROM JSON_ARRAY_ELEMENTS($1)
      `, [ namesJson ]);

      log('Committing migrations...');
      await client.query('COMMIT');
      log('Migrations committed.');
    } catch (err) {
      log('Caught error; rolling back', err);
      await client.query('ROLLBACK');
      throw err;
    }
  });
};

// Checks for pending migrations and returns an exit code of 1 if any are
// still pending/unapplied (e.g. automatically running migrations just failed).
const checkKnexMigrations = (db) => db.migrate.list({ directory: legacyPath })
  .then((res) => {
    if (res[1].length > 0)
      process.exitCode = 1;
  });

// Checks for pending migrations and returns an exit code of 1 if any are
// still pending/unapplied (e.g. automatically running migrations just failed).
const checkPostKnexMigrations = async config => {
  const log = (...args) => console.log('[checkPostKnexMigrations]', ...args); // eslint-disable-line no-console
  log('ENTRY');

  await withPg(config, async client => {
    const toRun = await getPostKnexMigrationsToRun(client);
    if (toRun.length) process.exitCode = 1;
  });
};

module.exports = { checkKnexMigrations, checkPostKnexMigrations, knexConnect, withKnex, withPg, knexMigrations, postKnexMigrations };
