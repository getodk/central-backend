// Functions for working with the "new" (2026) DB backup format.
// See https://github.com/getodk/central/issues/1646


const { execFile, execFileSync, spawn } = require('child_process');
const { promisify } = require('node:util');
const { mergeRight } = require('ramda');
const { env } = require('node:process');
const peek = require('buffer-peek-stream').promise;
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { streamSequentially } = require('./stream');


const onSpawnedClose = (spawnee) => {
  spawnee.on('close', (exitcode) => {
    if (exitcode !== 0) {
      const err = new Error(`process exited with code: ${exitcode}, spawnfile: ${spawnee.spawnfile}, args: ${spawnee.spawnargs}`);
      err.exitcode = exitcode;
      throw err;
    }
  });
};


const getPgDumpMajorVersion = () => promisify(execFile)(
  'pg_dump',
  ['--version'],
  { encoding: 'utf-8' },
).then(({ stdout }) => {
  const match = /^pg_dump \(PostgreSQL\) (\d+)\.\d+ /.exec(stdout);
  if (match === null) return;
  return parseInt(match[1], 10);
});


const getEncryptedPgDumpStream = async (passphrase = '') => {
  const compressType = await getPgDumpMajorVersion() >= 15 ? 'zstd:level=1' : '6'; // 6 is gzip's default, for postgres < 15. Postgres ≥ 15 supports more algoriths; dumps compress very well and fast with zstd at level 1.
  const spawned = spawn(
    '/bin/bash',
    [
      '-c',
      `pg_dump --no-password --format=custom --compress=${compressType} | openssl enc -chacha20 -pbkdf2 -pass env:ODK_BACKUP_PASSPHRASE`,
    ],
    {
      env: mergeRight(env, { ODK_BACKUP_PASSPHRASE: passphrase }),
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  onSpawnedClose(spawned);
  return spawned.stdout;
};


const getDecryptedPgRestoreStream = async (encryptedPgDumpStream, passphrase='') => {
  // We want to bail out early if the decrypt is not successful.
  // OpenSSL (they way we use it here) doesn't tell you whether this is the case. But we
  // can check it ourselves: try on the first handful of bytes of the stream, and see if we get
  // what looks like a pg_dump custom format file.
  const PEEK_NO_BYTES = 128; // should be more than enough, the openssl header is not that large
  const expectedPgDumpMagic = 'PGDMP'; // the pgdump custom format starts with this file magic
  const openSSLArgv = [
    'enc',
    '-d',
    '-pbkdf2',
    '-pass',
    'env:ODK_BACKUP_PASSPHRASE',
    '-chacha20',
  ];
  const envWithPassphrase = mergeRight(env, { ODK_BACKUP_PASSPHRASE: passphrase });
  const [peekbuf, reconstitutedInput] = await peek(encryptedPgDumpStream, PEEK_NO_BYTES);
  const peekDecrypted = execFileSync(
    'openssl',
    openSSLArgv,
    {
      input: peekbuf,
      env: envWithPassphrase,
    }
  );
  if (peekDecrypted.subarray(0, 5).toString('ascii') !== expectedPgDumpMagic) {
    const err = new Error('Incorrect passphrase supplied for decryption');
    err.exitcode = 100;
    throw err;
  }

  const spawned = spawn(
    '/bin/bash',
    [
      '-c',
      `openssl ${openSSLArgv.join(' ')} | pg_restore --exit-on-error --no-owner --no-acl --file=-`,
    ],
    {
      env: envWithPassphrase,
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  pipeline(reconstitutedInput, spawned.stdin);
  return spawned;
};


const restoreBackupFromRestoreStream = async (dumpRestoreStream) => {
  const restoreProcess = spawn(
    'psql',
    [
      '--no-password',
      '--no-psqlrc',
      '--quiet',
      '--no-align',
      '--tuples',
      '--echo-errors',
    ],
    {
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );

  const preamble = Readable.from(`
      -- Make a best effort to terminate other sessions that may block us dropping DB objects.
      -- We may not be DB superuser, in which case we can't drop connections from superusers.
      -- So first we try to drop all other sessions, which may fail, and then we try to terminate
      -- just our own.

      -- Might fail if we're not superuser and there are superuser sessions among those selected
      SELECT
          pg_terminate_backend(pid)
      FROM
          pg_stat_activity
      WHERE
          datname = current_database()
          AND pid != pg_backend_pid();

      -- Again, just for our user, useful in case the above failed
      SELECT
          pg_terminate_backend(pid)
      FROM
          pg_stat_activity
      WHERE
          datname = current_database()
          AND usename = CURRENT_USER
          AND pid != pg_backend_pid();

      BEGIN;
      DROP OWNED BY CURRENT_USER CASCADE;
  `);
  const postamble = Readable.from(`
      COMMIT;
  `);
  const allthesql = streamSequentially(preamble, dumpRestoreStream, postamble);
  pipeline(allthesql, restoreProcess.stdin);
  return restoreProcess;
};


module.exports = { getEncryptedPgDumpStream, getDecryptedPgRestoreStream, restoreBackupFromRestoreStream };
