// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { equals } = require('ramda');
const { task } = require('./task');

const logUpgrade = task.withContainer(({ Audits }) => async (version) => {
  const audit = await Audits.getLatestByAction('upgrade.server').then(o => o.orNull());
  if (!equals(audit?.details, version)) {
    await Audits.log(null, 'upgrade.server', null, version);
  }
});

module.exports = { logUpgrade };
