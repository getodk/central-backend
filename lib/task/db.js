// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains tasks that manipulate the database, primarily dumping and restoring
// for backups. See ./task.js for more information on what tasks are.

const { execFile } = require('child_process');
const { promisify } = require('node:util');

const DUMP_RESTORE_PARALELLISM = 4;


const psql = (statements, dbname) => {
  const specDB = dbname ? ['--dbname', dbname] : [];
  return promisify(execFile)(
    'psql',
    [
      ...specDB,
      '--no-password',
      '--no-psqlrc',
      '--quiet',
      '--no-align',
      '--tuples',
      '--command',
      statements
    ],
    { encoding: 'utf-8' },
  ).then(({ stdout }) => stdout.slice(0, -1));
};


// Performs a pg_dump on the configured database into the given directory. Does
// so using the postgres binary dump format in 4 parallel streams to multiple files.
// We no longer use this function in a task: it is only used in /v1/backup.
const pgdump = (outputDirectory) => promisify(execFile)(
  'pg_dump',
  [
    '--no-password',
    '--jobs', DUMP_RESTORE_PARALELLISM,
    '--format', 'd',
    '--file', outputDirectory
  ], {}
);

// Given a directory containing a valid pg_dump produced by the above task, restores the database
// to that state.
//
// Kicks everyone off the database before running the restore; allows them back in after.
// if something goes wrong midprocess; some manual detangling may be required to effect this process.
// but theoretically if the detangling can be done in such a way that this script then runs successfully,
// things should be okay.
const pgrestore = async (directory) => {
  // Ported for database configuration through libpq environment variables.
  // The backup/restore process itself is under consideration:
  // https://github.com/getodk/central/issues/1646

  const pgEntityQuote = (unquoted) => `"${unquoted.replaceAll('"', '""')}"`;
  const pgStringEscape = (unescaped) => `E'${unescaped.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

  // 1. to what database will we connect, actually. We could check env.PGDATABASE but that would/could be incorrect
  // if the PGSERVICE mechanism is used. Let's just connect and see what we end up with:
  const dbName = await psql('select current_database()');

  // 2. refuse new connections and close existing connections for that database.
  // In the ALTER DATABASE ddl statement, we can't execute current_database(), but we now know the DB name from step 1.
  try {
    await psql(`
      ALTER DATABASE ${pgEntityQuote(dbName)} ALLOW_CONNECTIONS FALSE;
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=${pgStringEscape(dbName)};
      `,
    'template1' // execute on the always-available public `template1`, since we cant set ALLOW_CONNECTIONS FALSE on the DB we're connected to
    );

    // 3. Do the restore. Note that with `--clean` + `--create`, we don't actually have an idea into which database we restored — the original name
    // of the database at backup time is used.
    //   - It could be a different one from the configured DB.
    //   - It could even be someone else's we dropped and replaced with ours.
    //   - We don't know what its name is so we can't tell the user this bit of critical info.
    //   - The user may not have made the backup themselves and may also not know the database name.
    // Discussion of this approach is pending.
    await promisify(execFile)(
      'pg_restore',
      [
        '--no-password',
        '--no-acl',
        '--exit-on-error',
        '--jobs', DUMP_RESTORE_PARALELLISM,
        '--format', 'd',
        '--create',
        '--clean', // create + clean results in dropping & recreating the database. This presumes some privileges that we might not have; this approach makes it hard to use a provisioned database :-/
        '--dbname', 'template1',
        directory,
      ],
    );
  } finally {
    // Restore connectivity
    await psql(`
      ALTER DATABASE ${pgEntityQuote(dbName)} ALLOW_CONNECTIONS TRUE;
      `,
    'template1' // execute on the always-available public `template1`
    );
  }
};

module.exports = { pgdump, pgrestore };
