const pg = require('pg');
const { sql } = require('slonik');

const logPrefix = `[central-backend|validateDb]`;
const logWith = console => (...args) => console.error(new Date().toISOString(), logPrefix, ...args); // eslint-disable-line no-console

const _expectedExtensions = [
  [ 'citext',             '1.8' ], // eslint-disable-line no-multi-spaces
  [ 'pg_trgm',            '1.6' ], // eslint-disable-line no-multi-spaces
  [ 'pgrowlocks',         '1.2' ], // eslint-disable-line no-multi-spaces
  [ 'pg_stat_statements', '1.12' ],
];

const compareExtensionVersions = (a, b) => {
  const [aMajor, aMinor] = a.split('.').map(s => Number(s));
  const [bMajor, bMinor] = b.split('.').map(s => Number(s));

  if (aMajor > bMajor) return 1;
  if (aMajor < bMajor) return -1;
  if (aMinor > bMinor) return 1;
  if (aMinor < bMinor) return -1;
  return 0;
};

const _checkExtensionVersions = async (process, console, any, expectedExtensions) => {
  const log = logWith(console);
  const exitWithErrorAndMessage = (...lines) => {
    log('ERROR:', lines.join('\n'));
    process.exit(1);
  };

  log('Checking PostgreSQL extensions...');

  const installedExtensions = await any(sql`SELECT extname AS name, extversion AS version FROM pg_extension`);
  const missing = [];
  const tooOld = [];
  const tooNew = [];
  for (const [ name, expectedVersion ] of expectedExtensions) {
    const installed = installedExtensions.find(i => i.name === name);
    if (!installed) missing.push(name);
    else {
      const comp = compareExtensionVersions(installed.version, expectedVersion);
      switch (comp) {
        case -1: tooOld.push({ extension: name, expectedVersion, actualVersion: installed.version }); break;
        case  0: /* extension matches */ break; // eslint-disable-line no-multi-spaces
        case  1: tooNew.push({ extension: name, expectedVersion, actualVersion: installed.version }); break; // eslint-disable-line no-multi-spaces
        default: throw new Error();
      }
    }
  }

  if (missing.length) {
    exitWithErrorAndMessage(
      `Missing expected PostgreSQL extension(s):`,
      '',
      ...missing.map(name => `  * ${name}`),
    );
  } else {
    log('All expected extensions were found; checking version numbers...');
  }

  if (tooOld.length) exitWithErrorAndMessage(
    `Out-of-date PostgreSQL extension version(s):`,
    '',
    ...tooOld.map(bad => `  * ${JSON.stringify(bad)}`),
    '',
    `  To update to the latest extension version(s):`,
    '',
    ...tooOld.map(bad => `      ALTER EXTENSION ${pg.utils.escapeIdentifier(bad.extension)} UPDATE;`),
  );

  if (tooNew.length) {
    log(
      `WARN: PostgreSQL extension version(s) are higher than expected; this may have surprising effects:\n\n` +
          tooNew.map(bad => `  * ${JSON.stringify(bad)}`).join('\n'),
    );
  } else {
    log('PostgreSQL extensions look OK.');
  }
};

const validateDb = async (process, console, { any, oneFirst }) => {
  class PgVersion {
    static denom = 10_000;

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
  const expectedPgVersion = new PgVersion(18_00_04);

  const log = logWith(console);

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

    await _checkExtensionVersions(process, console, any, _expectedExtensions);
  } catch (err) {
    log(`ERROR: ${err.message}`); // eslint-disable-line no-console
    process.exit(1);
  }
};

module.exports = {
  _expectedExtensions,
  _checkExtensionVersions,
  validateDb,
};
