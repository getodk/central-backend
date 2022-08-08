const should = require('should');
const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const http = require(appRoot + '/lib/util/http');

describe('util/http', () => {
  describe('isTrue', () => {
    const { isTrue } = http;
    it('should return true for truthy strings', () => {
      isTrue('TRUE').should.equal(true);
      isTrue('True').should.equal(true);
      isTrue('true').should.equal(true);
    });

    it('should return false for all other values', () => {
      isTrue('yes').should.equal(false);
      isTrue('on').should.equal(false);
      isTrue('').should.equal(false);
      isTrue(null).should.equal(false);
      isTrue(undefined).should.equal(false);
    });
  });

  describe('urlPathname', () => {
    const { urlPathname } = http;
    it('should return the pathname part of a url', () => {
      urlPathname('https://www.getodk.org/help').should.equal('/help');
    });

    it('should not include query parameters', () => {
      urlPathname('https://www.getodk.org/a/test/path?and=some&extra=bits').should.equal('/a/test/path');
    });
  });

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

    it('should not subserialize plain objects within an array', () => {
      serialize([{ a: 1 }, { b: 2, c: 3 }]).should.eql([{ a: 1 }, { b: 2, c: 3 }]);
    });
  });

  describe('format response helpers', () => {
    const { contentType, xml, atom, json } = http;
    // eslint-disable-next-line semi, space-before-function-paren, object-shorthand, func-names
    const mockResponse = () => ({ type: function(value) { this.contentType = value } });
    it('should ultimately return the result', () => {
      contentType()(42)(null, mockResponse()).should.equal(42);
    });

    it('should assign the requested content-type', () => {
      const request = mockResponse();
      contentType('mime/test')()(null, request);
      request.contentType.should.equal('mime/test');
    });

    it('should provide working shortcuts for common types', () => {
      const response = mockResponse();
      xml()(null, response);
      response.contentType.should.equal('application/xml');
      atom()(null, response);
      response.contentType.should.equal('application/atom+xml');
      json()(null, response);
      response.contentType.should.equal('application/json');
    });
  });

  describe('urlWithQueryParams', () => {
    const { urlWithQueryParams } = http;
    it('should return only a pathname', () => {
      urlWithQueryParams('/a/screaming/comes/across/the/sky').should.equal('/a/screaming/comes/across/the/sky');
    });

    it('should attach the given query parameters', () => {
      urlWithQueryParams('/kenosha/kid', { x: 1, y: 2 }).should.equal('/kenosha/kid?x=1&y=2');
    });

    it('should escape characters as required', () => {
      urlWithQueryParams('/path', { 'test?': '100%', 'etc=': '&c' }).should.equal('/path?test%3F=100%25&etc%3D=%26c');
    });

    it('should supplement and overwrite existing params', () => {
      urlWithQueryParams('/path?x=1&y=2', { y: 3, z: 5 }).should.equal('/path?x=1&y=3&z=5');
    });

    it('should unset keys given nully values', () => {
      urlWithQueryParams('/path?x=1&y=2&z=3', { x: null, z: undefined }).should.equal('/path?y=2');
    });
  });
});

