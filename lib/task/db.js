const { exec } = require('child_process');
const config = require('config');
const { task } = require('./task');

const pgdump = (directory) => {
  // formulate the dump command and run it against the directory.
  const dbConfig = config.get('default.database');
  const command = `pg_dump -j 4 -F d -f ${directory} -h ${dbConfig.host} -U ${dbConfig.user} ${dbConfig.database}`;
  const env = { PGPASSWORD: dbConfig.password };
  return task.promisify(exec)(command, { env });
};

module.exports = { pgdump };

