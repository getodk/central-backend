// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { task } = require('./task');

const logUpgrade = task.withContainer(({ Audits }) => () =>
  Audits.getLatestByAction('upgrade')
    .then((action) => {
      const oldTags = action.orNull()?.details;
      const newTags = process.env.SENTRY_TAGS || 'dev';

      if (oldTags !== newTags)
        return Audits.log(null, 'upgrade', null, newTags);
    }));

module.exports = { logUpgrade };
