const should = require('should');
const { identity } = require('ramda');
const appRoot = require('app-root-path');
const { resolve, getOrElse, getOrReject, getOrNotFound, timebound } = require(appRoot + '/lib/util/promise');
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
    let pass, fail, passed = false, failed = false;
    const promise = new Promise((resolve, reject) => { pass = resolve; fail = reject; });
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
    let pass, fail, passedWith;
    const promise = new Promise((resolve, reject) => { pass = resolve; fail = reject; });
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
    let pass, fail, passed = false, failed = false;
    const promise = new Promise((resolve, reject) => { pass = resolve; fail = reject; });
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

