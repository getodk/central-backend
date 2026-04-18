const assert = require('node:assert/strict');
const appRoot = require('app-root-path');
const Problem = require(appRoot + '/lib/util/problem');

describe('Problem', () => {
  const expectedRanges = {
    user: 400,
    internal: 500,
  };

  for (const [ type, problemMap ] of Object.entries(Problem)) {
    describe(`type: ${type}`, () => {
      const expectedRange = expectedRanges[type];

      it('should define an expected code range', () => {
        Number.isFinite(expectedRange).should.be.true();
        assert.equal(Math.floor(expectedRange / 100) * 100, expectedRange);
      });

      it('should not have duplicate Problem IDs', () => {
        const duplicates = Object.entries(
          Object
            .entries(problemMap)
            .reduce(
              (acc, [ name, { code } ]) => {
                if (!acc[code]) acc[code] = [];
                acc[code].push(name);
                return acc;
              },
              {},
            ),
        ).filter(([ , names ]) => names.length > 1);

        assert.deepEqual(duplicates, [], 'One or more numeric codes is shared by multiple Problems.');
      });

      for (const [ name, { code } ] of Object.entries(problemMap)) {
        describe(`problem: ${name}`, () => {
          it('should define a numeric code', () => {
            assert.equal(Number.isFinite(code), true, 'Code is not a valid number.');
          });

          it(`should be within ${expectedRange.toString().replace(/0/g, 'x')}`, () => {
            assert.equal(Math.floor(code / 100) * 100, expectedRange);
          });
        });
      }
    });
  }
});
