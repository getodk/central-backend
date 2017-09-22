const should = require('should');
const { merge } = require('../lib/util');

describe('util', () => {
  describe('merge', () => {
    it('should merge two plain shallow objects', () => {
      merge({ a: 1 }, { b: 2 }).should.eql({ a: 1, b: 2 });
    });
    it('should favor later attributes over earlier ones', () => {
      merge({ a: 1, c: 3 }, { b: 2, c: 5 }).should.eql({ a: 1, b: 2, c: 5 });
    });
    it('should merge arrays if it finds them', () => {
      merge({ a: 1, c: [ 3, 4 ] }, { b: 2, c: [ 5, 6 ] }).should.eql({ a: 1, b: 2, c: [ 3, 4, 5, 6 ] });
    });
    it('should ignore null parameters', () => {
      merge({ a: 1, c: 3 }, { b: 2, c: null }).should.eql({ a: 1, b: 2, c: 3 });
    });
  });
});

