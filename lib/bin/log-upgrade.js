// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script checks for the last known server version in the database
// and logs an upgrade event if the version has changed.

const { run } = require('../task/task');
const { logUpgrade } = require('../task/log-upgrade');

let version;
try {
  const tags = JSON.parse(process.env.SENTRY_TAGS || '{}');
  version = tags['version.central'];
} catch {
  version = null;
}

if (version) run(logUpgrade(version));
