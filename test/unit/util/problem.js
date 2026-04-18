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
        (Math.floor(expectedRange / 100) * 100).should.eql(expectedRange);
      });

      it('should declare all Problems in numeric order', () => {
        const declaredCodes = Object.values(problemMap).map(({ code }) => code);

        const sortedCodes = [ ...declaredCodes ].sort((a, b) => {
          const [intA, fracA] = a.toString().split('.');
          const [intB, fracB] = b.toString().split('.');

          if(intA !== intB) return intA - intB;
          if(fracA !== fracB) return fracA - fracB;

          return 0;
        });

        declaredCodes.should.eql(sortedCodes);
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

        duplicates.should.eql([], 'One or more numeric codes is shared by multiple Problems.');
      });

      for (const [ name, { code } ] of Object.entries(problemMap)) {
        describe(`problem: ${name}`, () => {
          it('should define a numeric code', () => {
            Number.isFinite(code).should.be.true('Code is not a valid number.');
          });

          it(`should be within ${expectedRange.toString().replace(/0/g, 'x')}`, () => {
            assert.equal(Math.floor(code / 100) * 100, expectedRange);
          });
        });
      }
    });
  }
});
