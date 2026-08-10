const assert = require('node:assert/strict');

const config = require('config');
const { sql } = require('slonik');

const { slonikPool } = require('../../lib/external/slonik');

describe('db connection', () => {
  afterEach(() => {
    delete process.env.PGSSLMODE;
    delete process.env.PGSSLROOTCERT;
  });

  it('should fail to create pool if PGSSLROOTCERT is set without PGSSLMODE', () => {
    process.env.PGSSLROOTCERT = './.pg-certs/ca.crt';
    assert.throws(() => slonikPool(config.default.database));
  });

  it('should fail to create pool if PGSSLROOTCERT is set with nonsense PGSSLMODE', () => {
    process.env.PGSSLMODE = 'not-a-real-setting';
    process.env.PGSSLROOTCERT = './.pg-certs/ca.crt';
    assert.throws(() => slonikPool(config.default.database));
  });

  it('should reject PGSSLROOTCERT if PGSSLMODE is not set', () => {
    process.env.PGSSLROOTCERT = './.pg-certs/ca.crt';
    assert.throws(() => slonikPool(config.default.database));
  });

  it(`should not connect to db if expected env vars are not set`, () => {
    let pool;
    try {
      pool = slonikPool(config.default.database);
      assert.rejects(() => pool.oneFirst(sql`SELECT 1`));
    } finally {
      pool?.end();
    }
  });

  it('should not connect to db if no root cert is supplied', async () => {
    process.env.PGSSLMODE = 'verify-full';

    let pool;
    try {
      pool = slonikPool(config.default.database);
      assert.rejects(() => pool.oneFirst(sql`SELECT 1`));
    } finally {
      pool?.end();
    }
  });

  it('should not connect to db if a different root cert is supplied', async () => {
    process.env.PGSSLMODE = 'verify-full';
    process.env.PGSSLROOTCERT = './.pg-certs/not-ca.crt';

    let pool;
    try {
      pool = slonikPool(config.default.database);
      assert.rejects(() => pool.oneFirst(sql`SELECT 1`));
    } finally {
      pool?.end();
    }
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
      pool?.end();
    }
  });
});
