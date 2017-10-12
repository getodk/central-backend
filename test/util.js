const should = require('should');
const { merge } = require('../lib/util');

describe('util', () => {
  describe('merge', () => {
    it('should merge two plain shallow objects', () => {
      merge({ a: 1 }, { b: 2 }).should.eql({ a: 1, b: 2 });
    });

    it('should favor later properties over earlier ones', () => {
      merge({ a: 1, c: 3 }, { b: 2, c: 4 }).should.eql({ a: 1, b: 2, c: 4 });
    });

    it('should not mutate its arguments', () => {
      const first = { a: 1 };
      merge(first, { b: 2 });
      first.should.eql({ a: 1 });
    });
  });
});
