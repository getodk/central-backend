const assert = require('node:assert/strict');

const config = require('config');
const { sql } = require('slonik');

const { slonikPool } = require('../../lib/external/slonik');

describe('db connection', () => {
  afterEach(() => {
    delete process.env.PGSSLMODE;
    delete process.env.PGSSLROOTCERT;
  });

  [
    {},
    { PGSSLMODE:'asdf', PGSSLROOTCERT:'nonsense' },
  ].forEach(envVars => {
    it(`should not connect to db if only ${JSON.stringify(envVars)} are set`, async () => {
      for (const [k, v] of Object.entries(envVars)) {
        process.env[k] = v;
      }

      let pool;
      try {
        pool = slonikPool(config.default.database);
        await assert.rejects(() => pool.oneFirst(sql`SELECT 1`));
      } finally {
        pool.end();
      }
    });
  });

  it('should connect to db if PGSSLMODE and PGSSLROOTCERT are supplied', async () => {
    process.env.PGSSLMODE = 'verify-full';
    process.env.PGSSLROOTCERT = './.pg-certs/ca.crt';

    let pool;
    try {
      pool = slonikPool(config.default.database);
      const res = await pool.oneFirst(sql`SELECT 1`);
      assert.equal(res, 1);
    } finally {
      pool.end();
    }
  });
});
