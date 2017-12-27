const should = require('should');
const builder = require('../../../../lib/model/query/builder');

// we aren't going to test the many problem types here, only the basic infrastructure.
describe('query module builder', () => {
  it('should return modules with an identical signature to the source, plus transacting', () => {
    Object.keys(builder({ a: 1, b: 2, c: 3 })).should.eql([ 'a', 'b', 'c', 'transacting' ]);
  });

  it('should call the bare function with the appropriate args', (done) => {
    builder({ f: (x, y) => {
      x.should.equal(42);
      y.should.equal(23);
      done();
    } }).f(42, 23);
  });

  it('should wrap the bare result proc in an ExplicitPromise', (done) => {
    const result = builder({ f: (x) => (y) => Promise.resolve(x + y) }).f(7);
    result.isExplicitPromise.should.equal(true);
    result.point(8).then((result) => {
      result.should.equal(15);
      done();
    });
  });

  it('should by default provide the initial container as the proc container', (done) => {
    builder({ f: () => (container) => Promise.resolve(container) }, 42)
      .f()
      .point()
      .then((result) => {
        result.should.equal(42);
        done();
      });
  });

  it('should provide a mirror of the source module under transacting', () => {
    Object.keys(builder({ a: 1, b: 2, c: 3 }).transacting).should.eql([ 'a', 'b', 'c' ]);
  });

  it('should set transacting on ExplicitPromises obtained from .transacting', () => {
    builder({ f: () => () => null }).transacting.f().options.transacting.should.equal(true);
  });
});

