const { sql } = require('slonik');

const validateDb = async ({ oneFirst }) => {
  class PgVersion {
    static denom = 10000;

    constructor(value) { this.value = Number(value); }

    get major() { return Math.floor(this.value / PgVersion.denom); }
    get minor() { return this.value % PgVersion.denom; }

    toString() { return `v${this.major}.${this.minor}`; }
  }
  // PostgreSQL version number format: major_00_minor
  const expectedPgVersion = new PgVersion(14_00_23);

  const logPrefix = `[central-backend|validateDb]`;
  const log = (...args) => console.error(new Date().toISOString(), logPrefix, ...args); // eslint-disable-line no-console
  const multiline = msgs => {
    const timestamp = new Date().toISOString();
    return msgs
      .map(line => `${timestamp} ${logPrefix} ${line}`)
      .join('\n');
  };
  const exitWithErrorAndMessage = msgs => {
    console.error(multiline([ // eslint-disable-line no-console
      '',
      `ERROR: startup failed:`,
      '',
      ...msgs,
      '',
    ]));
    process.exit(1);
  };
  const warnAndContinue = (firstLine, ...otherLines) => {
    if (!otherLines.length) return log('WARN:', firstLine);
    console.error(multiline([ // eslint-disable-line no-console
      '',
      `WARN: ${firstLine}`,
      ...otherLines,
      '',
    ]));
  };

  log('Testing database connection...');
  try {
    await oneFirst(sql`SELECT 1`);
  } catch (err) {
    exitWithErrorAndMessage([`Failed to connect to database: ${err.message}`]);
  }
  log('Connection OK.');

  log('Checking PostgreSQL version...');
  const actualPgVersion = new PgVersion(await oneFirst(sql`SELECT current_setting('server_version_num')::INT`));
  if (actualPgVersion.value === expectedPgVersion.value) {
    log('PostgreSQL version OK.');
  } else if (actualPgVersion.value > expectedPgVersion.value) {
    warnAndContinue(`Expected PostgreSQL ${expectedPgVersion} but found NEWER version: ${actualPgVersion}.  This may have unexpected effects.`);
  } else {
    exitWithErrorAndMessage([`Expected PostgreSQL ${expectedPgVersion} but found OLDER version: ${actualPgVersion}.  Please upgrade to the expected version.`]);
  }
};

module.exports = { validateDb };
