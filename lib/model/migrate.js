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

// TODO rename e.g. legacy-knex-migrator
// TODO move migration files to e.g. /migrations/legacy

const knex = require('knex');
const { knexConnection } = require('../util/db');

// Connects to the postgres database specified in configuration and returns it.
const knexConnect = (config) => knex({ client: 'pg', connection: knexConnection(config) });

// Connects to a database, passes it to a function for operations, then ensures its closure.
const withKnex = (config) => (mutator) => {
  const db = knexConnect(config);
  return mutator(db).finally(() => db.destroy());
};

// Given a database, initiates migrations on it.
const migrate = (db) => db.migrate.latest({ directory: `${__dirname}/migrations` });

// Checks for pending migrations and returns an exit code of 1 if any are
// still pending/unapplied (e.g. automatically running migrations just failed).
const checkMigrations = (db) => db.migrate.list({ directory: `${__dirname}/migrations` })
  .then((res) => {
    if (res[1].length > 0)
      process.exitCode = 1;
  });

module.exports = { checkMigrations, knexConnect, withKnex, migrate };

