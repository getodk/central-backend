const assert = require('node:assert/strict');

const config = require('config');
const { sql } = require('slonik');

const { slonikPool } = require('../../lib/external/slonik');

describe('db connection', () => {
  it('should connect to db', async () => {
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
