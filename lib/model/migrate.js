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

const knex = require('knex');
const { Migrator } = require('knex/lib/migrate/Migrator');
const { connectionObject } = require('../util/db');

// Connects to the postgres database specified in configuration and returns it.
const connect = (config) => knex({ client: 'pg', connection: connectionObject(config) });

// Connects to a database, passes it to a function for operations, then ensures its closure.
const withDatabase = (config) => (mutator) => {
  const db = connect(config);
  return mutator(db).finally(() => db.destroy());
};

// Given a database, initiates migrations on it.
const knexMigrations = (db) => db.migrate.latest({ directory: `${__dirname}/migrations/legacy` });
const postKnexMigrations = (db) => {
  // In the main, this migrator is written to behave similarly to knex's:
  //
  //   * re-uses knex_migrations table
  //   * expects transaction property async .up({ raw })
  //   * provides implementation of db.raw()
  //
  // Notable differences
  //
  //   * ONLY provides db.raw() function to transactions - no knex query builder etc.
  //   * ONLY implements up(); will throw if a transaction has other properties, except for `down()` which will be ignored for pre-2025 migrations
  //   * does not use a separate knex_migrations_lock table (in fact, this should be DROPped as the first post-knex migration TODO is this comfortable?)
  //   * gets list of migrations to run _after_ acquiring db lock
  //   * sets migration_time to be the start of the migration batch's transaction rather than some other intermediate time


  // TODO consider whether the knex_migrations_lock table is useful vs. just locking the whole migrations table (probably fine)
  // TODO can we just fail if there is ANY waiting for lock acquisition?  probably simpler than handling edge cases like knex does (probably)
  // TODO would life be simpler if we get the list of migrations to run AFTER acquiring the lock? (probably)
  // TODO understand whether we want to run all migrations in the same transaction, or separately.  seems like currently all run in the same transaction, although knex provides options for isolating a single migration, and for using separate transactions for each

  //  1. TODO start transaction (most aggressive type)
  //  2. TODO if migration table does not exist, CREATE IT
  //  3. TODO get lock on knex_migrations table; throw if lock not available IMMEDIATELY
  //  4. TODO get list of migrations to run
  //  5. TODO validate migrations to run (e.g. do they have unexpected properties)
  //  7. TODO remove any migrations from list which were run while waiting for the lock
  //  8. TODO run all migrations
  //  9. TODO get migration batch number (COALESCE(MAX(batch), 0) + 1)
  // 10. TODO update knex_migrations table to include newly-run migrations (migration_time should either be NOW() or CLOCK_TIMESTAMP(), but currently unclear whether knex has been running all migrations in the same tx or not)
};

// Checks for pending migrations and returns an exit code of 1 if any are
// still pending/unapplied (e.g. automatically running migrations just failed).
const checkMigrations = (db) => db.migrate.list({ directory: `${__dirname}/migrations` })
  .then((res) => {
    if (res[1].length > 0)
      process.exitCode = 1;
  });

module.exports = { checkMigrations, connect, withDatabase, knexMigrations, postKnexMigrations };

