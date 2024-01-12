// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// This script creates the databases jubilant and jubilant_test. It is meant to
// be run in a Docker environment in which the POSTGRES_PASSWORD environment
// variable is set to 'odktest'.

const pg = require('pg');

const logFor = level => (...args) => console.error(`[${level}]`, 'drop-docker-database', ...args);
const log = logFor('INFO');
log.err = logFor('ERROR');
log.warn = logFor('WARN');

(async () => {
  try {
    const db = new pg.Pool({ host: 'localhost', user: 'postgres', password: 'odktest', database: 'postgres' });

    async function exec(query) {
      try {
        const res = await db.query(query);
      } catch(err) {
        log.warn('query failed:', { query, error:err.message });
      }
    }

    await exec('DROP DATABASE IF EXISTS jubilant');
    await exec('DROP DATABASE IF EXISTS jubilant_test');
    await exec('DROP USER IF EXISTS jubilant');
    await exec('DROP ROLE IF EXISTS jubilant');

    db.end();

    log('Completed OK');
  } catch(err) {
    log.err('fatal error:', err);
    process.exit(1);
  }
})();

