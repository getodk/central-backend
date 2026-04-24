// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { createPool, createDateTypeParser, createBigintTypeParser, createIntervalTypeParser, createNumericTypeParser } = require('slonik');
const { setlibpqEnv } = require('../util/load-db-env');

const timestampTypeParser = { name: 'timestamp', parse: (x) => new Date(x) };
const timestamptzTypeParser = { name: 'timestamptz', parse: (x) => new Date(x) };

const slonikPool = (config) => {
  setlibpqEnv(config);
  return createPool('postgres://', {
    captureStackTrace: false,
    maximumPoolSize: config.maximumPoolSize ?? 10,
    typeParsers: [
      createDateTypeParser(),
      createBigintTypeParser(),
      createIntervalTypeParser(),
      createNumericTypeParser(),
      timestampTypeParser,
      timestamptzTypeParser
    ]
  });
};

module.exports = { slonikPool };

