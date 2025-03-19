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
const { knexConnection } = require('../util/db');

// Connects to the postgres database specified in configuration and returns it.
const knexConnect = (config) => knex({ client: 'pg', connection: knexConnection(config) });

// Connects to a database, passes it to a function for operations, then ensures its closure.
const withKnex = (config) => (mutator) => {
  const db = knexConnect(config);
  return mutator(db).finally(() => db.destroy());
};

// Given a database, initiates migrations on it.
// Ignore missing migrations, as they probably came from the new migrator.
const migrate = (db) => db.migrate.latest({ directory: `${__dirname}/migrations/legacy`, disableMigrationsListValidation: true });

module.exports = { knexConnect, withKnex, migrate };

