const should = require('should');
const { identity } = require('ramda');
const { FutureQuery, MappedFutureQuery, FoldedFutureQuery } = require('../../../../lib/model/query/future-query');

describe('FutureQuery', () => {
  describe('single/base', () => {
    it('should flag itself as an ExplicitPromise', () =>
      (new FutureQuery()).isExplicitPromise.should.equal(true));

    it('should perform its proc upon point, with container context', (done) => {
      (new FutureQuery((container) => {
        container.should.equal(12);
        done();
      })).point(12);
    });

    it('should yield the point result as a Promise', (done) => {
      (new FutureQuery((container) => Promise.resolve(container * 2)))
        .point(12)
        .then((result) => {
          result.should.equal(24);
          done();
        });
    });

    it('should apply failure handlers via then', (done) => {
      (new FutureQuery(() => Promise.reject(-1)))
        .point()
        .then(identity, (fail) => {
          fail.should.equal(-1);
          done();
        });
    });

    it('should apply failure handlers via catch', (done) => {
      (new FutureQuery(() => Promise.reject(-1)))
        .point()
        .catch((fail) => {
          fail.should.equal(-1);
          done();
        });
    });

    it('should apply pre-point thens once pointed', (done) => {
      let hasMapped = false;
      const fq = (new FutureQuery((container) => Promise.resolve(container * 2)))
        .then((x) => {
          hasMapped = true;
          return x * 2;
        });
      hasMapped.should.equal(false);

      fq.point(2).then((y) => {
        y.should.equal(8);
        done();
      });
    });

    it('should apply pre-point then-fails once pointed', (done) => {
      (new FutureQuery(() => Promise.reject(-1)))
        .then(identity, (fail) => {
          fail.should.equal(-1);
          done();
        })
        .point();
    });

    it('should apply pre-point catches once pointed', (done) => {
      (new FutureQuery(() => Promise.reject(-1)))
        .catch((x) => {
          x.should.equal(-1);
          done();
        })
        .point();
    });

    it('should apply pre-point thens once pointed (x2 for .then.then)', (done) => {
      let hasMapped = false;
      const fq = (new FutureQuery((container) => Promise.resolve(container * 2)))
        .then((x) => x * 2)
        .then((x) => {
          hasMapped = true;
          return x * 2;
        });
      hasMapped.should.equal(false);

      fq.point(2).then((y) => {
        y.should.equal(16);
        done();
      });
    });

    it('should apply pre-point catches once pointed (x2 for .then.then)', (done) => {
      (new FutureQuery(() => Promise.reject(-1)))
        .then((x) => x * 2)
        .catch((fail) => {
          fail.should.equal(-1);
          done();
        })
        .point();
    });

    const transactable = (done) => {
      const result = { _trxnCount: 0, db: { transaction: (f_) => {
        result._trxnCount += 1;
        return f_(`transaction ${result._trxnCount}`);
      } } };
      return result;
    };

    it('should transform container to transacting if requested via options', (done) => {
      (new FutureQuery(((container) => Promise.resolve(container.db)), { transacting: true }))
        .point(transactable())
        .then((x) => {
          x.should.equal('transaction 1');
          done();
        });
    });

    it('should transform container to transacting if requested via call', (done) => {
      (new FutureQuery((container) => Promise.resolve(container.db)))
        .transacting()
        .point(transactable())
        .then((x) => {
          x.should.equal('transaction 1');
          done();
        });
    });

    it('should swallow multiple transaction calls', (done) => {
      (new FutureQuery((container) => Promise.resolve(container.db)))
        .transacting()
        .transacting()
        .point(transactable())
        .then((x) => {
          x.should.equal('transaction 1');
          done();
        });
    });

    it('should reuse existing transaction if it exists', (done) => {
      (new FutureQuery((container) => Promise.resolve(container.db)))
        .then(identity)
        .transacting()
        .point(transactable())
        .then((x) => {
          x.should.equal('transaction 1'); // asserting that this is not transaction 2
          done();
        });
    });
  });
});

