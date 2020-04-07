const should = require('should');
const builder = require('../../../../lib/model/query/builder');
const streamTest = require('streamtest').v2;

describe('query module builder', () => {
  it('should return modules with an identical signature to the source', () => {
    Object.keys(builder({ a: 1, b: 2, c: 3 })).should.eql([ 'a', 'b', 'c' ]);
  });

  it('should call the bare function with the appropriate args', (done) => {
    builder({ f: (x, y) => {
      x.should.equal(42);
      y.should.equal(23);
      done();
    } }).f(42, 23);
  });

  it('should by default provide the initial container as the proc container', (done) => {
    builder({ f: () => (container) => Promise.resolve(container) }, 42)
      .f()
      .then((result) => {
        result.should.equal(42);
        done();
      });
  });

  it('should automatically catch postgres exceptions', () =>
    builder({ f: () => () => Promise.reject(new Error('Key (id)=(42) already exists.')) })
      .f()
      .should.be.rejected()
      .then((result) => {
        result.message.should.equal('Key (id)=(42) already exists.');
      }));

  it('should wrap returned streams with promises', (done) => {
    builder({ f: () => () => streamTest.fromObjects([ {} ]) })
      .f()
      .then((result) => {
        // the fact that .then() does not crash is really the point here.
        done();
      });
  });

  it('should not wrap helper results with anything', () => {
    builder({ helper: { f: (x) => (container) => {
      x.should.equal(14);
      container.should.equal(42);
      return 128;
    } } }, 42)
      .helper.f(14)
      .should.equal(128);
  });
});

