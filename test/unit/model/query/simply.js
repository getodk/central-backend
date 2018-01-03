const should = require('should');
const { identity } = require('ramda');
const { getWhere } = require('../../../../lib/model/query/simply');

// for now, all we test is getWhere, and only as a proxy to test applyConditions.
// the rest of the code in the module passes ye olde "obviously correct" test:
// look at the code, and it does exactly what it says.
describe('simply', () => {
  describe('applyConditions', () => {
    // fakes a database and calls f with the arguments given to .where() across all calls:
    const fakeDb = (f) => {
      const calls = [];
      const where = (...conditions) => {
        calls.push(conditions);
        return { where, then: () => { f(calls); } };
      };
      return { select: () => ({ from: () => ({ where, then: () => { f(calls); } }) }) };
    };
    // wraps away a bunch of boilerplate:
    const whereForConditions = (conditions, f) => getWhere(null, conditions)({ db: fakeDb(f) });

    it('should simply chain if no conditions are provided', (done) => {
      whereForConditions(null, (result) => {
        // expect no calls.
        result.should.eql([]);
        done();
      });
    });

    it('should directly apply plain objects', (done) => {
      whereForConditions({ x: 1, y: 2 }, (result) => {
        // expect one call with a single argument consisting of the object literal:
        result.should.eql([ [{ x: 1, y: 2 }] ]);
        done();
      });
    });

    it('should directly apply 3-tuples', (done) => {
      whereForConditions([ 'x', '<', '3' ], (result) => {
        // expect one call with three arguments matching the array literal:
        result.should.eql([ [ 'x', '<', '3' ] ]);
        done();
      });
    });

    it('should apply combinations of plain objects', (done) => {
      whereForConditions([{ a: 1, b: 2 }, { x: 3, y: 4 }], (result) => {
        // expect two calls with a single argument each consisting of the object literal:
        result.should.eql([ [{ a: 1, b: 2 }], [{ x: 3, y: 4 }] ]);
        done();
      });
    });

    it('should apply combinations of 3-tuples', (done) => {
      whereForConditions([[ 'x', '<', '3' ], [ 'y', '>', '4' ]], (result) => {
        // expect two calls with three arguments each matchi the array literals:
        result.should.eql([ [ 'x', '<', '3' ], [ 'y', '>', '4' ] ]);
        done();
      });
    });
  });
});

