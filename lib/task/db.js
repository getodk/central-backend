// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains tasks that manipulates the database, primarily dumping and restoring
// for backups. See ./task.js for more information on what tasks are.

const { exec } = require('child_process');
const { writeFile } = require('fs');
const config = require('config');
const { mergeRight } = require('ramda');
const { isBlank } = require('../util/util');
const { task } = require('./task');
const tmp = require('tmp-promise');

// Performs a pg_dump on the configured database into the given directory. Does
// so using the postgres binary dump format in 4 parallel streams to multiple files.
const pgdump = (directory) => {
  // formulate the dump command and run it against the directory.
  const dbConfig = config.get('default.database');
  const command = `pg_dump -j 4 -F d -f ${directory} -h ${dbConfig.host} -U ${dbConfig.user} ${dbConfig.database}`;
  const env = mergeRight(process.env, { PGPASSWORD: dbConfig.password });
  return task.promisify(exec)(command, { env });
};

// Given a directory containing a valid pg_dump produced by the above task, restores the database
// to that state.
//
// Kicks everyone off the database before running the restore; allows them back in after.
// if something goes wrong midprocess; some manual detangling may be required to effect this process.
// but theoretically if the detangling can be done in such a way that this script then runs successfully,
// things should be okay.
const pgrestore = async (directory, namespace = 'default') => {
  const dbConfig = config.get(`${namespace}.database`);
  const env = mergeRight(process.env, { PGPASSWORD: dbConfig.password });

  // write the script that kicks everybody off the database (can't -c as it is multiple statements):
  const script = `
    UPDATE pg_database SET datallowconn = 'false' WHERE datname = '${dbConfig.database}';
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbConfig.database}';
  `;
  await tmp.withFile(async (tmpfile) => {
    await task.promisify(writeFile)(tmpfile.path, script);

    // now run that script:
    const runScript = `psql -h ${dbConfig.host} -U ${dbConfig.user} -d template1 -f ${tmpfile.path}`;
    const result = await task.promisify(exec)(runScript, { env });
    if (!isBlank(result.stderr)) throw new Error(result.stderr);
  });

  // actually do the restore:
  const invokeRestore = `pg_restore -e -j 4 -F d -C -c -h ${dbConfig.host} -U ${dbConfig.user} -d template1 ${directory}`;
  await task.promisify(exec)(invokeRestore, { env });

  // now we have to allow connections again:
  const enableConnections = `UPDATE pg_database SET datallowconn = 'true' WHERE datname = '${dbConfig.database}';`;
  return task.promisify(exec)(`psql -h ${dbConfig.host} -U ${dbConfig.user} -d template1 -c "${enableConnections}"`, { env });
};

module.exports = { pgdump, pgrestore };

