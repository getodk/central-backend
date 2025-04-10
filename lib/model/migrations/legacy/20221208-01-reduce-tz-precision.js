// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Issue:        #cb459 - `gt` filter for submissionDate is not working as expected because of tz precision
// Root cause:   Default timestamptz precision in postgres is microseconds and node/js has just milliseconds
// Solution:     Let's change precision to milliseconds in database, since there is no value in having higher precision
//               in the database when application can't use/handle it + typical usage of ODK Central doesn't demand higher
//               precision.

const getTablesWithTimestampColumns = (db) => db.raw(`
  SELECT
    table_name, JSON_AGG(column_name) AS columns
  FROM
    information_schema.columns
  WHERE table_schema = 'public'
    AND udt_name = 'timestamptz'
  GROUP BY table_name`);

const changePrecision = (db, tablename, columns, precision) => db.raw(`
  ALTER TABLE ${tablename} 
  ${columns.map(c => `ALTER COLUMN "${c}" TYPE timestamptz(${precision})`).join(', ')}
`);

const up = async (db) => {
  console.log('Migrating timestamps, this may take a while if you have a lot of submissions.'); // eslint-disable-line no-console

  const tables = await getTablesWithTimestampColumns(db);

  for (const table of tables.rows) {
    await changePrecision(db, table.table_name, table.columns, 3); // eslint-disable-line no-await-in-loop
  }
};

const down = async (db) => {
  const tables = await getTablesWithTimestampColumns(db);

  for (const table of tables.rows) {
    await changePrecision(db, table.table_name, table.columns, 6); // eslint-disable-line no-await-in-loop
  }
};

module.exports = { up, down };
