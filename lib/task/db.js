const { exec } = require('child_process');
const { writeFile } = require('fs');
const config = require('config');
const { merge } = require('ramda');
const { isBlank } = require('../util/util');
const { task } = require('./task');
const { tmpfile } = require('./fs');

const pgdump = (directory) => {
  // formulate the dump command and run it against the directory.
  const dbConfig = config.get('default.database');
  const command = `pg_dump -j 4 -F d -f ${directory} -h ${dbConfig.host} -U ${dbConfig.user} ${dbConfig.database}`;
  const env = merge(process.env, { PGPASSWORD: dbConfig.password });
  return task.promisify(exec)(command, { env });
};

// kicks everyone off the database before running the restore; allows them back in after.
// if something goes wrong midprocess; some manual detangling may be required to effect this process.
// but theoretically if the detangling can be done in such a way that this script then runs successfully,
// things should be okay.
const pgrestore = async (directory, namespace = 'default') => {
  const dbConfig = config.get(`${namespace}.database`);
  const env = merge(process.env, { PGPASSWORD: dbConfig.password });

  // write the script that kicks everybody off the database (can't -c as it is multiple statements):
  const scriptPath = await tmpfile();
  const script = `
    UPDATE pg_database SET datallowconn = 'false' WHERE datname = '${dbConfig.database}';
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbConfig.database}';
  `;
  await task.promisify(writeFile)(scriptPath, script);

  // now run that script:
  const runScript = `psql -h ${dbConfig.host} -U ${dbConfig.user} -d template1 -f ${scriptPath}`;
  const result = await task.promisify(exec)(runScript, { env });
  if (!isBlank(result.stderr)) throw new Error(result.stderr);

  // actually do the restore:
  const invokeRestore = `pg_restore -e -j 4 -F d -C -c -h ${dbConfig.host} -U ${dbConfig.user} -d template1 ${directory}`;
  await task.promisify(exec)(invokeRestore, { env });

  // now we have to allow connections again:
  const enableConnections = `UPDATE pg_database SET datallowconn = 'true' WHERE datname = '${dbConfig.database}';`;
  return task.promisify(exec)(`psql -h ${dbConfig.host} -U ${dbConfig.user} -d template1 -c "${enableConnections}"`, { env });
};

module.exports = { pgdump, pgrestore };

