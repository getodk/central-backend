const appRoot = require('app-root-path');
const { getOrElse, getOrReject, getOrNotFound, timebound, runSequentially } = require(appRoot + '/lib/util/promise');
const Option = require(appRoot + '/lib/util/option');
const Problem = require(appRoot + '/lib/util/problem');

describe('getOr', () => {
  it('Else: should unwrap Some[value]', () => {
    getOrElse(23)(Option.of(42)).should.equal(42);
  });

  it('Else: should use else given None', () => {
    getOrElse(23)(Option.none()).should.equal(23);
  });

  it('Reject: should unwrap Some[value]', () => {
    getOrReject(Problem.internal.unknown())(Option.of(42)).should.equal(42);
  });

  it('Reject: should reject with the rejection given None', (done) => {
    getOrReject(Problem.internal.unknown())(Option.none())
      .catch((problem) => {
        problem.problemCode.should.equal(500.1);
        done();
      });
  });

  it('NotFound: should unwrap Some[value]', () => {
    getOrNotFound(Option.of(42)).should.equal(42);
  });

  it('NotFound: should reject with the rejection given None', (done) => {
    getOrNotFound(Option.none())
      .catch((problem) => {
        problem.problemCode.should.equal(404.1);
        done();
      });
  });
});

describe('timebound @slow', () => {
  it('should not reject if the promise resolves', (done) => {
    // eslint-disable-next-line one-var-declaration-per-line, one-var
    let pass, passed = false, failed = false;
    // eslint-disable-next-line no-shadow
    const promise = new Promise((resolve) => { pass = resolve; });
    timebound(promise, 0.2)
      .then(() => { passed = true; }, () => { failed = true; });

    pass(42);
    setTimeout(() => {
      passed.should.equal(true);
      failed.should.equal(false);
      done();
    }, 250);
  });

  it('should resolve with the correct value', (done) => {
    // eslint-disable-next-line one-var-declaration-per-line, one-var
    let pass, passedWith;
    // eslint-disable-next-line no-shadow
    const promise = new Promise((resolve) => { pass = resolve; });
    timebound(promise, 0.2).then((x) => { passedWith = x; });

    pass(42);
    setTimeout(() => {
      passedWith.should.equal(42);
      done();
    }, 10);
  });

  it('should reject upon timebound', (done) => {
    timebound(new Promise(() => {}), 0.1)
      .catch((err) => {
        err.problemCode.should.equal(502.1);
        done();
      });
  });

  it('should not resolve if the timebound passes', (done) => {
    // eslint-disable-next-line one-var-declaration-per-line, one-var
    let pass, passed = false, failed = false;
    // eslint-disable-next-line no-shadow
    const promise = new Promise((resolve) => { pass = resolve; });
    timebound(promise, 0.1)
      .then(() => { passed = true; }, () => { failed = true; });

    setTimeout(() => {
      passed.should.equal(false);
      failed.should.equal(true);
      pass(42);
      setTimeout(() => {
        passed.should.equal(false);
        failed.should.equal(true);
        done();
      }, 10);
    }, 150);
  });
});

describe('runSequentially', () => {
  it('should return an empty array when passed an empty array', async () => {
    const result = await runSequentially([]);
    result.should.be.eql([]);
  });

  it('returns the results of the functions in order when passed an array of functions', async () => {
    const fn1 = () => Promise.resolve('result1');
    const fn2 = () => Promise.resolve('result2');
    const fn3 = () => Promise.resolve('result3');

    const result = await runSequentially([fn1, fn2, fn3]);

    result.should.be.eql(['result1', 'result2', 'result3']);
  });

  it('should throw error if any of the functions throws an error', async () => {
    const fn1 = () => Promise.resolve('result1');
    const fn2 = () => Promise.reject(new Error('result2'));
    const fn3 = () => Promise.resolve('result3');

    try {
      await runSequentially([fn1, fn2, fn3]);
    } catch (err) {
      err.message.should.equal('result2');
    }
  });
});
