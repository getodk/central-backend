const should = require('should');
const { identity } = require('ramda');
const appRoot = require('app-root-path');
const { resolve, getOrElse, getOrReject, getOrNotFound } = require(appRoot + '/lib/util/promise');
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

