const { sql } = require('slonik');

const validateDb = async (process, console, { oneFirst }) => {
  class PgVersion {
    static denom = 10000;

    constructor(value) { this.value = Number(value); }

    get major() { return Math.floor(this.value / PgVersion.denom); }
    get minor() { return this.value % PgVersion.denom; }

    toString() { return `v${this.major}.${this.minor}`; }
  }

  class PgValidateError extends Error {
    constructor(message, options) {
      super(message, options);
      this.name = 'PgValidateError';
      Error.captureStackTrace(this, this.constructor);
    }
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
  const warnAndContinue = (firstLine, ...otherLines) => {
    if (!otherLines.length) return log('WARN:', firstLine);
    console.error(multiline([ // eslint-disable-line no-console
      '',
      `WARN: ${firstLine}`,
      ...otherLines,
      '',
    ]));
  };

  try {
    log('Testing database connection...');
    await oneFirst(sql`SELECT 1`);
    log('Connection OK.');

    log('Checking PostgreSQL version...');
    const actualPgVersion = new PgVersion(await oneFirst(sql`SELECT current_setting('server_version_num')::INT`));
    if (actualPgVersion.value === expectedPgVersion.value) {
      log('PostgreSQL version OK.');
    } else if (actualPgVersion.value > expectedPgVersion.value) {
      warnAndContinue(`Expected PostgreSQL ${expectedPgVersion} but found NEWER version: ${actualPgVersion}.  This may have unexpected effects.`);
    } else {
      throw new PgValidateError(`Expected PostgreSQL ${expectedPgVersion} but found OLDER version: ${actualPgVersion}.  Please upgrade to the expected version.`);
    }
  } catch (err) {
    console.error(multiline([ // eslint-disable-line no-console
      '',
      `ERROR:`,
      '',
      `    ${err.message}`,
      '',
    ]));
    process.exit(1);
  }
};

module.exports = { validateDb };
