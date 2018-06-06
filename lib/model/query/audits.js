// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { DateTime, Duration } = require('luxon');
const { maybeRowToInstance, rowsToInstances } = require('../../util/db');

module.exports = {
  // "latest" returns only the very newest audit log matching the given condition.
  getLatestWhere: (condition) => ({ db, Audit }) =>
    db.select('*').from('audits')
      .where(condition)
      .orderBy('loggedAt', 'desc')
      .limit(1)
      .then(maybeRowToInstance(Audit)),

  // "recent" gets all logs in the past duration (default 3 days) matching the given condition.
  getRecentWhere: (condition, duration = { days: 3 }) => ({ db, Audit }) =>
    db.select('*').from('audits')
      .where(condition)
      .where('loggedAt', '>=', DateTime.local().minus(Duration.fromObject(duration)))
      .orderBy('loggedAt', 'desc')
      .then(rowsToInstances(Audit))
};

