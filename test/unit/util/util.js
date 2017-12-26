const should = require('should');
const { identity } = require('ramda');
const util = require('../../../lib/util/util');

describe('util', () => {
  describe('isBlank', () => {
    const { isBlank } = util;
    it('should return true for nonexistentish values', () => {
      isBlank(null).should.equal(true);
      isBlank(undefined).should.equal(true);
      isBlank('').should.equal(true);
    });

    it('should return false for existentish values', () => {
      isBlank(' ').should.equal(false);
      isBlank(0).should.equal(false);
      isBlank(false).should.equal(false);
    });
  });

  describe('printPairs', () => {
    // testing here is light as this is only ever used to format debug text.
    const { printPairs } = util;
    it('should print a simple representation of a shallow dictionary', () => {
      printPairs({ a: 1, b: 'test', c: null }).should.equal("a: 1, b: 'test', c: null");
    });
  });

  describe('without', () => {
    const { without } = util;
    it('should remove the specified keys', () => {
      without([ 'b', 'd' ], { a: 1, b: 2, c: 3, d: 4, e: 5 }).should.eql({ a: 1, c: 3, e: 5 });
    });

    it('should actually remove the keys', () => {
      without([ 'b' ], { a: 1, b: 2 }).hasOwnProperty('b').should.equal(false);
    });

    it('should not touch or reify prototype keys', () => {
      const x = { a: 1, b: 2 };
      const y = Object.create(x);
      y.c = 3;

      without([ 'a' ], y).should.eql({ c: 3 });
      y.a.should.equal(1);
    });

    it('should do nothing given no keys or no obj', () => {
      without([], { a: 1 }).should.eql({ a: 1 });
      without([ 'test' ]).should.eql({});
    });
  });

  describe('get', () => {
    const { get } = util;
    it('should traverse an object tree to its target', () => {
      get({ a: { b: { c: 2 }, d: 3 } }, [ 'a', 'b', 'c' ]).should.equal(2);
    });

    it('should return undefined if the target does not exist', () => {
      should(get({ a: {} }, [ 'a', 'b', 'c' ])).equal(undefined);
    });

    it('should return source if the source does not exist', () => {
      should(get(null, [ 'x', 'y' ])).equal(null);
      should(get(undefined, [ 'x', 'y' ])).equal(undefined);
    });

    it('should return the source if no keys are given', () => {
      get({ x: 5, y: 7 }, []).should.eql({ x: 5, y: 7 });
    });
  });

  describe('ensureArray', () => {
    const { ensureArray } = util;
    it('should wrap non-arrays in an array', () => {
      ensureArray(null).should.eql([ null ]);
      ensureArray({ x: 1 }).should.eql([{ x: 1 }]);
    });

    it('should return arrays as-is', () => {
      ensureArray([]).should.eql([]);
      ensureArray([[]]).should.eql([[]]);
      ensureArray([ undefined ]).should.eql([ undefined ]);
    });
  });

  describe('incr', () => {
    const { incr } = util;
    it('should return incrementing values starting with 1', () => {
      const inst = incr();
      inst().should.equal(1);
      inst().should.equal(2);
      inst().should.equal(3);
    });

    it('should not leak values between instances', () => {
      const a = incr();
      a().should.equal(1);
      const b = incr();
      a().should.equal(2);
      b().should.equal(1);
      a().should.equal(3);
      b().should.equal(2);
    });
  });

  describe('hashPassword/verifyPassword', () => {
    const { hashPassword, verifyPassword } = util;
    // we do not actually verify the hashing itself, as:
    // 1. it is entirely performed by bcrypt, which has is own tests.
    // 2. bcrypt is intentionally slow, and we would like unit tests to be fast.

    it('should always return an ExplicitPromise', () => {
      hashPassword('').isExplicitPromise.should.equal(true);
      hashPassword('password').isExplicitPromise.should.equal(true);
      verifyPassword('password', 'hashhash').isExplicitPromise.should.equal(true);
    });

    it('should return an ExplicitPromise of null given a blank plaintext', (done) => {
      hashPassword('').point().then((result) => {
        should(result).equal(null);
        done();
      });
    });
  });
});

