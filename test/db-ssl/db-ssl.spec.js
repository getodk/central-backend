const assert = require('node:assert/strict');

const config = require('config');
const { sql } = require('slonik');

const { slonikPool } = require('../../lib/external/slonik');

const E_CERT_VERIFICATION_FAILED = /ConnectionError: unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca/;
const E_INCOMPATIBLE_ENV = { message: 'Incompatible values for env vars: PGSSLMODE, PGSSLROOTCERT.' };

describe('db connection', () => {
  afterEach(() => {
    delete process.env.PGSSLMODE;
    delete process.env.PGSSLROOTCERT;
  });

  it('should fail to create pool if PGSSLROOTCERT is set without PGSSLMODE', () => {
    process.env.PGSSLROOTCERT = './.pg-certs/ca.crt';
    assert.throws(() => slonikPool(config.default.database), E_INCOMPATIBLE_ENV);
  });

  [
    'nonsense',
    'require',
    'disable',
    '',
  ].forEach(sslMode => {
    it(`should fail to create pool if PGSSLROOTCERT is set with PGSSLMODE="${sslMode}"`, () => {
      process.env.PGSSLMODE = sslMode;
      process.env.PGSSLROOTCERT = './.pg-certs/ca.crt';
      assert.throws(() => slonikPool(config.default.database), E_INCOMPATIBLE_ENV);
    });
  });

  it('should fail to create pool if cert file is missing', () => {
    process.env.PGSSLMODE = 'verify-full';
    process.env.PGSSLROOTCERT = './.pg-certs/ca-does-not-exist-at-this-path.crt';
    assert.throws(() => slonikPool(config.default.database), { code: 'ENOENT' });
  });

  it('should fail to create pool if cert file is a directory', () => {
    process.env.PGSSLMODE = 'verify-full';
    process.env.PGSSLROOTCERT = '/';
    assert.throws(() => slonikPool(config.default.database), { code: 'EISDIR' });
  });

  it('should fail at first query if cert file is a file, but not a cert', async () => {
    process.env.PGSSLMODE = 'verify-full';
    process.env.PGSSLROOTCERT = './.pg-certs/server.csr';
    await assertFirstQueryFailsWith(E_CERT_VERIFICATION_FAILED);
  });

  it(`should not connect to db if expected env vars are not set`, async () => {
    await assertFirstQueryFailsWith(/ConnectionError: no pg_hba.conf entry for host .*, no encryption/);
  });

  ['verify-ca', 'verify-full'].forEach(sslMode => {
    describe(`ssl mode: ${sslMode}`, () => {
      it('should not connect to db if no root cert is supplied', async () => {
        process.env.PGSSLMODE = sslMode;
        await assertFirstQueryFailsWith(E_CERT_VERIFICATION_FAILED);
      });

      it('should not connect to db if a different root cert is supplied', async () => {
        process.env.PGSSLMODE = sslMode;
        process.env.PGSSLROOTCERT = './.pg-certs/not-ca.crt';
        await assertFirstQueryFailsWith(E_CERT_VERIFICATION_FAILED);
      });

      it('should connect to db if PGSSLMODE and PGSSLROOTCERT are supplied', async () => {
        process.env.PGSSLMODE = sslMode;
        process.env.PGSSLROOTCERT = './.pg-certs/ca.crt';
        await assertFirstQuerySucceeds();
      });
    });
  });
});

async function assertFirstQuerySucceeds() {
  let pool;
  try {
    pool = slonikPool(config.default.database);
    const res = await pool.oneFirst(sql`SELECT 1`);
    assert.equal(res, 1);
  } finally {
    await pool?.end();
  }
}

async function assertFirstQueryFailsWith(expectedError) {
  await assert.rejects(
    () => assertFirstQuerySucceeds(),
    expectedError,
  );
}
