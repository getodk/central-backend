// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { withDatabase } = require('../model/migrate');

(async () => {
  try {
    const { rows } = await withDatabase(require('config').get('default.database'))((db) =>
      db.raw('SELECT COUNT(*) FROM pg_stat_activity WHERE usename=CURRENT_USER'));
    const queryCount = rows[0].count - 1; // the count query will appear as one of the open queries

    console.log('Open query count:', queryCount);

    if (queryCount) process.exit(2);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
