const appRoot = require('app-root-path');
const http = require(appRoot + '/lib/util/http');
const Option = require(appRoot + '/lib/util/option');

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
      isTrue(2).should.equal(false);
    });
  });

  describe('isFalse', () => {
    const { isFalse } = http;
    it('should return true for falsey strings', () => {
      isFalse('FALSE').should.equal(true);
      isFalse('False').should.equal(true);
      isFalse('false').should.equal(true);
    });

    it('should return false for all other values', () => {
      isFalse('no').should.equal(false);
      isFalse('off').should.equal(false);
      isFalse('').should.equal(false);
      isFalse(null).should.equal(false);
      isFalse(undefined).should.equal(false);
      isFalse(2).should.equal(false);
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

  describe('format response helpers', () => {
    const { contentType, xml, atom, json } = http;
    // eslint-disable-next-line semi, object-shorthand
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

  describe('urlDecode()', () => {
    const { urlDecode } = http;

    [
      [ '', '' ],
      [ '%20', ' ' ],
      [ 'abc123', 'abc123' ],
    ].forEach(([ decodable, expected ]) => {
      it(`should successfully decode '${decodable}' to Option.of('${expected}')`, () => {
        const decoded = urlDecode(decodable);
        (decoded instanceof Option).should.equal(true);
        decoded.isDefined().should.equal(true);
        decoded.get().should.equal(expected);
      });
    });

    [
      '%',
      '%ae',
    ].forEach(undecodable => {
      it(`should decode '${undecodable}' to Option.None`, () => {
        const decoded = urlDecode(undecodable);
        (decoded instanceof Option).should.equal(true);
        decoded.isEmpty().should.equal(true);
      });
    });
  });
});

