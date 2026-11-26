const { sql } = require('slonik');

class PgVersion {
  static denom = 10_000;

  static parseValue(value) {
    const t = typeof value;

    try {
      if (t === 'number') return value;
      if (t === 'string') {
        const [ , big, small ] = value.match(/^(\d+)\.(\d+)$/);
        return (big * Number(PgVersion.denom)) + Number(small);
      }
    } catch (_) { /*falls through*/ }

    throw new Error(`Failed to parse version of type '${t}', value '${value}'.`);
  }

  constructor(value) { this.value = PgVersion.parseValue(value); }

  get major() { return Math.floor(this.value / PgVersion.denom); }
  get minor() { return this.value % PgVersion.denom; }

  toString() { return `v${this.major}.${this.minor}`; }
}

const validateDb = async (process, console, { oneFirst }) => {
  class PgValidateError extends Error {
    constructor(message, options) {
      super(message, options);
      this.name = 'PgValidateError';
      Error.captureStackTrace(this, this.constructor);
    }
  }

  const expectedPgVersion = new PgVersion('18.4');

  const logPrefix = `[central-backend|validateDb]`;
  const log = (...args) => console.error(new Date().toISOString(), logPrefix, ...args); // eslint-disable-line no-console

  try {
    log('Testing database connection...');
    await oneFirst(sql`SELECT 1`);
    log('Connection OK.');

    log('Checking PostgreSQL version...');
    const actualPgVersion = new PgVersion(await oneFirst(sql`SELECT current_setting('server_version_num')::INT`));
    if (actualPgVersion.major === expectedPgVersion.major) {
      if (actualPgVersion.minor < expectedPgVersion.minor) {
        log(`WARN: Expected PostgreSQL ${expectedPgVersion} but found OLDER version: ${actualPgVersion}.  Please upgrade to the expected version.`);
      } else {
        log('PostgreSQL version OK.');
      }
    } else if (actualPgVersion.value > expectedPgVersion.value) {
      log(`WARN: Expected PostgreSQL ${expectedPgVersion} but found NEWER version: ${actualPgVersion}.  This may have unexpected effects.`);
    } else {
      throw new PgValidateError(`Expected PostgreSQL ${expectedPgVersion} but found OLDER version: ${actualPgVersion}.  Please upgrade to the expected version.`);
    }
  } catch (err) {
    log(`ERROR: ${err.message}`); // eslint-disable-line no-console
    process.exit(1);
  }
};

module.exports = {
  PgVersion,
  validateDb,
};
