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

const { readdirSync } = require('node:fs');
const Path = require('node:path');

const knex = require('knex');
const { withPgSslConfig } = require('../util/db');
const { setlibpqEnv } = require('../util/load-db-env');

const log = (...args) => console.log('[knex-migrator]', ...args); // eslint-disable-line no-console

class KnexMigrationSource {
  #directory;

  constructor(directory) {
    this.#directory = directory;
  }

  getMigrations() {
    return readdirSync(this.#directory)
      .filter(it => it.endsWith('.js'))
      .sort();
  }

  getMigrationName(name) { return name; }

  getMigration(name) {
    const { up, down } = require(Path.join(this.#directory, name)); // eslint-disable-line import/no-dynamic-require
    const mLog = (...args) => log(`[${name}]`, ...args);

    return {
      up: async db => {
        mLog('Starting...');
        const res = await up(db, mLog);
        mLog('Completed OK.');
        return res;
      },
      down: async db => {
        mLog('[down] Starting...');
        const res = await down(db, mLog);
        mLog('[down] Completed OK.');
        return res;
      },
    };
  }
};

// Connects to the postgres database specified in configuration and returns it.
const knexConnect = (config) => {
  setlibpqEnv(config);
  return knex({ client: 'pg', connection: withPgSslConfig({}) });
};

// Connects to a database, passes it to a function for operations, then ensures its closure.
const withKnex = (config) => (mutator) => {
  const db = knexConnect(config);
  return mutator(db).finally(() => db.destroy());
};

// Given a database, initiates migrations on it.
const migrate = async (db) => {
  log('[knex-migrator]', 'Starting...');
  const migrationSource = new KnexMigrationSource(`${__dirname}/migrations`);
  await db.migrate.latest({ migrationSource });
  log('[knex-migrator]', 'Completed OK.');
};

module.exports = { knexConnect, withKnex, migrate, KnexMigrationSource };

