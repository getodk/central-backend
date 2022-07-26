// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// CRCRCR uhhhh confusing naming maybe idk
const _postgres = require('postgres');
const { connectionString } = require('../util/db');

const options = {
  // when saving to the database we transform all undefined to null rather than
  // throw. this ought to be safe at time of writing because it's exactly what
  // we did with slonik. possibly someday with better hygiene this can go away.
  transform: { undefined: null },
  types: {
    // the functions here are how postgres implements them for numerics.
    // the issue is just that for range safety reasons they do not include
    // bigint in their default impl, which is a problem we are unlikely to have.
    // the practical problem is that count() in postgres yields a bigint.
    bigint: { to: 0, from: [ 20 ], serialize: (x => '' + x), parse: (x => +x) },

    // we don't want to automatically assume all non-true values can be safely
    // equal to 'f', since we can take user input here.
    boolean: {
      to: 16, from: 16,
      serialize: (x => (x === true ? 't' : x === false ? 'f' : x)),
      parse: (x => x === 't')
    }
  }
};
const postgres = (config) => _postgres(connectionString(config), options);

// turns out you can get the templater just by omitting connection info completely.
// and p/postgres is happy to mix template literals across "connections".
const sql = _postgres(undefined, options);

module.exports = { postgres, sql, options };

