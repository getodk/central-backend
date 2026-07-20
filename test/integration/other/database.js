const { sql } = require('slonik');

const { testContainer } = require('../setup');

describe.only('database', () => {
  describe('pg_stat_statements', () => {
    it('should allow reading postgres stats', testContainer(async ({ all }) => {
      const stats = await all(sql`
        SELECT query
             , calls
             , round(total_exec_time::numeric, 2) AS total_ms
             , round(mean_exec_time::numeric, 2) AS mean_ms
             , rows
          FROM pg_stat_statements
          ORDER BY total_exec_time DESC
      `);

      stats.should.be.an.Array();
    }));

    it('should allow clearing postgres stats', testContainer(async ({ run }) => {
      const cleared = await run(sql`SELECT pg_stat_statements_reset()`);
      cleared.should.be.true();
    }));
  });
});
