const should = require('should');
const { identity } = require('ramda');
const { ExplicitPromise, MappedExplicitPromise, resolve } = require('../../../lib/util/promise');

describe('ExplicitPromise', () => {
  it('should construct', () =>
    (new ExplicitPromise(Promise.resolve(true))).should.be.an.instanceof(ExplicitPromise));

  it('should flag itself as isExplicitPromise', () =>
    (new ExplicitPromise(Promise.resolve(true))).isExplicitPromise.should.equal(true));

  it('should always return a flat ExplicitPromise via of', () => {
    const single = ExplicitPromise.of(Promise.resolve(true));
    single.should.be.an.instanceof(ExplicitPromise);

    ExplicitPromise.of(ExplicitPromise.of(Promise.resolve(true))).should.deepEqual(single);
  });

  it('should return a Promise primitive when pointed', () => {
    const promise = Promise.resolve(42);
    ExplicitPromise.of(promise).point().should.equal(promise);
  });

  it('should return another ExplicitPromise when then is called', () => {
    ExplicitPromise.of(Promise.resolve(4)).then((x) => x).should.be.an.instanceof(ExplicitPromise);
  });

  it('should apply the then-map when pointed', (done) => {
    ExplicitPromise.of(Promise.resolve(8))
      .then((x) => x + 7)
      .point()
      .then((result) => {
        result.should.equal(15);
        done();
      });
  });

  it('should pass container context up the tree if given', () => {
    let result;
    const dummy = { point: (container) => { result = container; return Promise.resolve(16); } };
    (new MappedExplicitPromise(dummy)).point(23);
    result.should.equal(23);
  });

  it('should re-point if the mapped result is another ExplicitPromise', (done) => {
    ExplicitPromise.of(Promise.resolve(30))
      .then((x) => ExplicitPromise.of(Promise.resolve(x + 8)))
      .point()
      .then((y) => {
        y.should.equal(38);
        done();
      });
  });

  it('should provide container context to pointed inner map results', (done) => {
    ExplicitPromise.of(Promise.resolve(40))
      .then((x) => ({
        isExplicitPromise: true,
        point: (container) => { return Promise.resolve(x + container); }
      }))
      .point(15)
      .then((y) => {
        y.should.equal(55);
        done()
      });
  });

  it('should comply with thenabale-fail if rejected', (done) => {
    ExplicitPromise.of(Promise.reject(-1))
      .then(identity, (fail) => {
        fail.should.equal(-1);
        done();
      })
      .point();
  });

  it('should allow catch syntactic sugar', (done) => {
    ExplicitPromise.of(Promise.reject(-1))
      .catch((fail) => {
        fail.should.equal(-1);
        done();
      })
      .point();
  });

  describe('fromCallback legacy CPS API conversion', () => {
    it('should resolve via callback if no error is found', (done) => {
      ExplicitPromise.fromCallback((cb) => cb(null, 42)).point().then((result) => {
        result.should.equal(42);
        done();
      });
    });

    it('should reject via callback if an error is provided', (done) => {
      ExplicitPromise.fromCallback((cb) => cb(-1, null)).point().catch((result) => {
        result.should.equal(-1);
        done();
      });
    });
  });

  it('package should provide a resolve that obeys point', (done) => {
    resolve(20).point().then((x) => {
      x.should.equal(20);
      done();
    });
  });
});
 

