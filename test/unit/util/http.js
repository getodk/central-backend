const should = require('should');
const appRoot = require('app-root-path');
const http = require(appRoot + '/lib/util/http');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');

describe('util/http', () => {
  describe('serialize', () => {
    const { serialize } = http;
    it('should passthrough nullish values', () => {
      should(serialize(null)).equal(null);
      should(serialize(undefined)).equal(undefined);
    });

    it('should call forApi on the target if it exists', () => {
      serialize({ forApi: () => 42 }).should.equal(42);
    });

    it('should leave strings alone', () => {
      serialize('hello').should.equal('hello');
    });

    it('should jsonify any other values it finds', () => {
      serialize(42).should.equal('42');
      serialize({ x: 1 }).should.equal('{"x":1}');
    });

    it('should subserialize each element if an array is found', () => {
      serialize([
        'hello',
        { forApi: () => 42 },
        [ 'world',
          { forApi: () => 23 } ]
      ]).should.eql(['hello', 42, [ 'world', 23 ] ]); // TODO: is this actually the desired result?
    });
  });
});

