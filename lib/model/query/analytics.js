// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');

/* eslint-disable quotes, quote-props */
const metrics = {
  "system": {
    "num_admins": {
      "recent": {},
      "total": {}
    },
    "num_projects_encryption": {
      "recent": {},
      "total": {}
    },
    "num_questions_biggest_form": {},
    "num_audit_log_entries": {},
    "backups_configured": {},
    "database_size": {}
  },
};
/* eslint-enable quotes, quote-props */

const databaseSize = () => ({ one }) => one(sql`
select pg_database_size(current_database()) as database_size`);

const backupsEnabled = () => ({ one }) => one(sql`
select count(*) as backups_configured from config where key = 'backups.main'`);

const previewMetrics = () => (({ Analytics }) => Promise.all([
  Analytics.databaseSize(),
  Analytics.backupsEnabled()
]).then((values) => {
  // system
  for (const [key, value] of Object.entries(values[0]))
    metrics.system[key] = value;
  for (const [key, value] of Object.entries(values[1]))
    metrics.system[key] = value;
  return metrics;
}));

module.exports = { backupsEnabled, databaseSize, previewMetrics };
