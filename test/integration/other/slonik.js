const should = require('should');
const { sql } = require('slonik');
const { testContainer } = require('../setup');

describe('slonik', () => {
  describe('query()', () => {
    it('should accept symbols', testContainer(async ({ db }) => {
      const { SqlToken } = require('slonik/dist/src/tokens');

      SqlToken.should.be.a.Symbol();
      SqlToken.description.should.equal('SLONIK_TOKEN_SQL');

      const res = await db.all(sql`
        SELECT * FROM roles WHERE id=${{ type: SqlToken, values: [], sql: '1 OR TRUE' }}
      `);

      res.should.eql([
        { TODO: true },
      ]);
    }));

    it('should not accept non-symbols', testContainer(async ({ db }) => {
      let caught;

      try {
        await db.all(sql`
          SELECT * FROM roles WHERE id=${{ type: 'SLONIK_TOKEN_SQL', values: [], sql: '1 OR TRUE' }}
        `).should.be.rejected();
      } catch (err) {
        caught = err;
      }

      should(caught).be.an.Error();
    }));
  });
});
