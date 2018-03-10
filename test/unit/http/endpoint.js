const should = require('should');
const { EventEmitter } = require('events');
const { createRequest, createResponse } = require('node-mocks-http');
const streamTest = require('streamtest').v2;
const { identity } = require('ramda');
const { DateTime } = require('luxon');

const appRoot = require('app-root-path');
const { finalize, endpoint, openRosaEndpoint, sendError } = require(appRoot + '/lib/http/endpoint');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');
const { ExplicitPromise } = require(appRoot + '/lib/util/promise');

const createModernResponse = () => {
  const result = createResponse({ eventEmitter: EventEmitter });
  // node-mocks-http does not have hasHeader yet.
  result.hasHeader = function(name) {
    return this.getHeader(name) != null;
  };

  // express adds this.
  result.status = function(code) {
    this.statusCode = code;
    return this;
  };

  return result;
};

describe('endpoints', () => {
  describe('finalize', () => {
    it('should simply return simple values', () => {
      let result, writeResult = (x) => { result = x };
      finalize(writeResult)(42);
      result.should.equal(42);

      finalize(writeResult)('test');
      result.should.equal('test');

      finalize(writeResult)({ x: 1 });
      result.should.eql({ x: 1 });
    });

    it('should pass Some[value] as value', () => {
      let result, writeResult = (x) => { result = x };
      finalize(writeResult)(Option.of('test'));
      result.should.equal('test');
    });

    it('should fail None with the empty result internal Problem', () => {
      let result, writeResult = (x) => { result = x };
      finalize(null, writeResult)(Option.none());
      result.isProblem.should.equal(true);
      result.problemCode.should.equal(500.3);
    });

    it('should pipe through stream results', (done) => {
      let result, writeResult = (x) => { result = x };
      const requestTest = streamTest.fromChunks();
      const responseTest = streamTest.toText((_, result) => {
        result.should.equal('ateststream');
        done();
      });
      finalize(null, null, requestTest, responseTest)(streamTest.fromChunks([ 'a', 'test', 'stream' ]));
    });

    it('should immediately abort the database query if the request is aborted', (done) => {
      const requestTest = new EventEmitter();
      const responseTest = streamTest.toText((_, result) => {
        result.should.not.equal('ateststream');
      });
      const source = streamTest.fromChunks([ 'a', 'test', 'stream' ], 1000);
      source.end = done;
      finalize(null, null, requestTest, responseTest)(source);
      requestTest.emit('close');
    });


    it('should not crash if the request is aborted but the stream is not endable', () => {
      const requestTest = new EventEmitter();
      const responseTest = streamTest.toText((_, result) => {
        result.should.not.equal('ateststream');
      });
      const source = streamTest.fromChunks([ 'a', 'test', 'stream' ], 1000);
      finalize(null, null, requestTest, responseTest)(source);
      requestTest.emit('close');
    });

    it('should point any ExplicitPromises it finds', (done) => {
      finalize((result) => {
        result.should.equal(42);
        done();
      })(ExplicitPromise.of(ExplicitPromise.of(Promise.resolve(42))));
    });

    it('should attach to any Promises it finds', (done) => {
      let resolve;
      const p = new Promise((r) => { resolve = r; });
      finalize((result) => {
        result.should.equal(42);
        done();
      })(p);
      resolve(42);
    });

    it('should call failure if a Problem is found', () => {
      let result, writeResult = (x) => { result = x };
      finalize(null, writeResult)(Problem.user.notFound());
      result.isProblem.should.equal(true);
    });
  });

  describe('endpoint', (done) => {
    it('should attach a json Content-Type absent any other', () => {
      const response = createModernResponse();
      endpoint(() => 'test')(createRequest(), response);
      response.getHeader('Content-Type').should.equal('application/json');
    });

    it('should not attach a json Content-Type if one is already present', () => {
      const response = createModernResponse();
      endpoint((request, response) => {
        response.setHeader('Content-Type', 'application/xml');
        return 'test';
      })(createRequest(), response);
      response.getHeader('Content-Type').should.equal('application/xml');
    });

    it('should send the given response', () => {
      const response = createModernResponse();
      endpoint(() => 'test')(createRequest(), response);
      response._getData().should.equal('test');
    });
  });

  describe('openRosaEndpoint', () => {
    // TODO: perhaps swap out forOpenRosa checks for the response check via sendError, as
    // forOpenRosa is an internal routing detail.
    it('should reject requests lacking a version', (done) => {
      const headers = { 'Date': DateTime.local().toHTTP() };
      openRosaEndpoint(identity)(createRequest({ headers }), createResponse(), (error) => {
        error.forOpenRosa.isProblem.should.equal(true);
        error.forOpenRosa.problemDetails.field.should.equal('X-OpenRosa-Version');
        done();
      });
    });

    it('should reject requests with an unexpected version', (done) => {
      const headers = { 'X-OpenRosa-Version': '2.0' };
      openRosaEndpoint(identity)(createRequest({ headers }), createResponse(), (error) => {
        error.forOpenRosa.isProblem.should.equal(true);
        error.forOpenRosa.problemDetails.field.should.equal('X-OpenRosa-Version');
        done();
      });
    });

    it('should reject requests lacking a date', (done) => {
      const headers = { 'X-OpenRosa-Version': '1.0' };
      openRosaEndpoint(identity)(createRequest({ headers }), createResponse(), (error) => {
        error.forOpenRosa.isProblem.should.equal(true);
        error.forOpenRosa.problemDetails.field.should.equal('Date');
        done();
      });
    });

    it('should reject requests with an invalid date format', (done) => {
      const headers = { 'X-OpenRosa-Version': '1.0', 'Date': '2012-12-12T12:12:12z' };
      openRosaEndpoint(identity)(createRequest({ headers }), createResponse(), (error) => {
        error.forOpenRosa.isProblem.should.equal(true);
        error.forOpenRosa.problemDetails.field.should.equal('Date');
        done();
      });
    });

    const goodHeaders = { 'X-OpenRosa-Version': '1.0', 'Date': DateTime.local().toHTTP() };
    it('should wrap returned problems into an openrosa response format', (done) => {
      const problem = new Problem(400, 'test message');
      const response = createModernResponse();

      response.on('end', () => {
        response.statusCode.should.equal(400);
        response._getData().trim().should.equal('<OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">\n    <message nature="error">test message</message>\n  </OpenRosaResponse>');
        done();
      });

      openRosaEndpoint(() => problem)(createRequest({ headers: goodHeaders }), response, sendError);
    });

    it('should pass successful OpenRosa responses straight through', (done) => {
      const response = createModernResponse();
      response.on('end', () => {
        response.statusCode.should.equal(200);
        response._getData().should.equal('test');
        done();
      });
      openRosaEndpoint(() => ({ code: 200, body: 'test' }))(createRequest({ headers: goodHeaders }), response);
    });
  });

  describe('sendError', () => {
    it('should adapt Problem code to http code', (done) => {
      const response = createModernResponse();
      response.on('end', () => {
        response.statusCode.should.equal(409);
        done();
      });
      sendError(new Problem(409.1138, 'test message'), null, response);
    });

    it('should set json return type', (done) => {
      const response = createModernResponse();
      response.on('end', () => {
        response.getHeader('Content-Type').should.equal('application/json');
        done();
      });
      sendError(new Problem(409.1138, 'test message'), null, response);
    });

    it('should provide Problem details in the body', (done) => {
      const response = createModernResponse();
      response.on('end', () => {
        response._getData().code.should.equal(409.1138);
        response._getData().message.should.equal('test message');
        response._getData().details.should.eql({ x: 1 });
        done();
      });
      sendError(new Problem(409.1138, 'test message', { x: 1 }), null, response);
    });

    it('should detect and translate errors from the bodyparser middleware', (done) => {
      const bodyParser = require('body-parser');
      const request = createRequest({
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': 8
        }
      });
      request.resume = identity;
      const response = createModernResponse();
      response.on('end', () => {
        response.statusCode.should.equal(400);
        response._getData().details.should.eql({ format: 'json', rawLength: 8 });
        done();
      });
      bodyParser.json({ type: 'application/json' })(request, response, (error) => sendError(error, request, response));
      request.emit('data', 'not json');
      request.emit('end');
    });

    it('should turn remaining errors into unknown Problems', (done) => {
      const response = createModernResponse();
      const error = new Error('oops');
      error.stack = ''; // strip stack so that our test output isn't super polluted
      response.on('end', () => {
        response.statusCode.should.equal(500);
        response._getData().message.should.equal('Completely unhandled exception: oops');
        done();
      });
      sendError(error, null, response);
    });
  });

});

