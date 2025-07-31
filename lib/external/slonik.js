// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { createPool, createDateTypeParser, createBigintTypeParser, createIntervalTypeParser, createNumericTypeParser, sql } = require('slonik');
const { connectionString } = require('../util/db');

const timestampTypeParser = { name: 'timestamp', parse: (x) => new Date(x) };
const timestamptzTypeParser = { name: 'timestamptz', parse: (x) => new Date(x) };

// We depend on C.UTF-8 for error message parsing. See https://github.com/getodk/central/issues/1199
// Unless we set this, the server's LC_MESSAGES locale is applied.
// The override via the POSTGRESQL_MESSAGES_LOCALE env var is used for testing.
const DEFAULT_MESSAGES_LOCALE = 'C.UTF-8';

const slonikPool = (config, lcMessages) => {
  const POSTGRESQL_MESSAGES_LOCALE = lcMessages || process.env.ODK_POSTGRESQL_MESSAGES_LOCALE || DEFAULT_MESSAGES_LOCALE;
  const POSTGRESQL_SET_MESSAGES_LOCALE = sql`SELECT set_config('lc_messages', ${POSTGRESQL_MESSAGES_LOCALE}, FALSE)`;

  return createPool(connectionString(config), {
    captureStackTrace: false,
    maximumPoolSize: config.maximumPoolSize ?? 10,
    typeParsers: [
      createDateTypeParser(),
      createBigintTypeParser(),
      createIntervalTypeParser(),
      createNumericTypeParser(),
      timestampTypeParser,
      timestamptzTypeParser
    ],
    resetConnection: async (connection) => {
      await connection.query(sql`DISCARD ALL`);
      await connection.query(POSTGRESQL_MESSAGES_LOCALE);
    },
    interceptors: [{
      afterPoolConnection: async (_connectionContext, connection) => {
        await connection.query(POSTGRESQL_SET_MESSAGES_LOCALE);
      },
    }],
  });
};

module.exports = { slonikPool };

