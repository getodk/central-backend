// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { withKnex, checkKnexMigrations, checkPostKnexMigrations } = require('../model/migrate');

// REVIEW why is check-migrations required in the first place?

(async () => {
  try {
    const config = require('config').get('default.database');
    await withKnex(config)(checkKnexMigrations);
    await checkPostKnexMigrations(config);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
