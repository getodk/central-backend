// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { withKnex } = require('../model/knex-migrator');

(async () => {
  try {
    const markerComment = `-- marker: ${Math.random()}`;

    const { rows: unfiltered } = await withKnex(require('config').get('default.database'))((db) =>
      db.raw(`
        ${markerComment}
        SELECT state
             , query_start
             , query
          FROM pg_stat_activity
          WHERE usename = CURRENT_USER
            AND state != 'idle'
      `)
    );
    const filtered = unfiltered.filter(({ query }) => !query.includes(markerComment));

    console.log('Open queries:', JSON.stringify(filtered));

    if (filtered.length) process.exit(2);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
