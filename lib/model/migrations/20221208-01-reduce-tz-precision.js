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

const getTimestampColumns = (db) => db.raw(`
  SELECT
    table_name, column_name, is_nullable
  FROM
    information_schema.columns
  WHERE
    table_schema = 'public'
    AND udt_name = 'timestamptz'`)
  .then(data => data.rows);

const changePrecision = (db, columnMeta, precision) => db.schema.alterTable(columnMeta.table_name, (table) => {
  if (columnMeta.is_nullable === 'YES') {
    table.dateTime(columnMeta.column_name, { useTz: true, precision }).alter();
  } else {
    table.dateTime(columnMeta.column_name, { useTz: true, precision }).notNullable().alter();
  }
});

const up = async (db) => {
  const columns = await getTimestampColumns(db);

  await Promise.all(columns.map(c => changePrecision(db, c, 3)));
};

const down = async (db) => {
  const columns = await getTimestampColumns(db);

  await Promise.all(columns.map(c => changePrecision(db, c, 6)));
};

module.exports = { up, down };
