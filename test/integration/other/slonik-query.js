const { sql } = require('slonik');
const { testContainer } = require('../setup');

describe('slonik', () => {
  describe('query()', () => {
    it('should accept symbols', testContainer(async ({ db }) => {
      const { SLONIK_TOKEN_SQL } = require('slonik/dist/src/tokens');

      SLONIK_TOKEN_SQL.should.be.a.Symbol();

      const res = await db.all(sql`
        SELECT * FROM roles WHERE id=${{ type: SLONIK_TOKEN_SQL, values: [], sql: '1 OR TRUE' }}
      `);

      res.should.eql([
        { TODO: true },
      ]);
    }));

    it('should not accept non-symbols', testContainer(({ db }) => {
      return db.all(sql`
        SELECT * FROM roles WHERE id=${{ type: 'SLONIK_TOKEN_SQL', values: [], sql: '1 OR TRUE' }}
      `).should.be.rejected();
    }));
  });
});
