const should = require('should');
const { EventEmitter } = require('events');
const { createRequest, createResponse } = require('node-mocks-http');
const streamTest = require('streamtest').v2;
const { identity } = require('ramda');

const appRoot = require('app-root-path');
const { finalize, endpoint, openRosaEndpoint, odataEndpoint, sendError } = require(appRoot + '/lib/http/endpoint');
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
      openRosaEndpoint(identity)(createRequest(), createResponse(), (error) => {
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

    const goodHeaders = { 'X-OpenRosa-Version': '1.0' };
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

  describe('odataEndpoint', () => {
    it('should reject json requests to xml endpoints', (done) => {
      const request = createRequest({ headers: { Accept: 'application/json' } });
      const response = createModernResponse();
      odataEndpoint.xml(null)(request, response, (error) => {
        error.problemCode.should.equal(406.1);
        done();
      });
    });

    it('should reject xml requests to json endpoints', (done) => {
      const request = createRequest({ headers: { Accept: 'atom' } });
      const response = createModernResponse();
      odataEndpoint.json(null)(request, response, (error) => {
        error.problemCode.should.equal(406.1);
        done();
      });
    });

    it('should reject requests for OData max-versions below 4.0', (done) => {
      const request = createRequest({ headers: { 'OData-MaxVersion': '3.0' } });
      const response = createModernResponse();
      odataEndpoint.json(null)(request, response, (error) => {
        error.problemCode.should.equal(404.1);
        done();
      });
    });

    it('should reject requests for unsupported OData features', (done) => {
      const request = createRequest({ url: '/odata.svc?$orderby=magic' });
      const response = createModernResponse();
      odataEndpoint.json(null)(request, response, (error) => {
        error.problemCode.should.equal(501.1);
        done();
      });
    });

    it('should set the appropriate OData version', (done) => {
      const request = createRequest();
      const response = createModernResponse();
      response.on('end', () => {
        response.getHeader('OData-Version').should.equal('4.0');
        done();
      });
      odataEndpoint.json(() => ({ success: true }))(request, response);
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

    it('should translate 403 replies to Tableau into 401 Basic auth directives', (done) => {
      const response = createModernResponse();
      const request = createRequest({
        headers: {
          'User-Agent': 'Tableau Desktop 10500.18.0305.1200; public; libcurl-client; 64-bit; en_US; Mac OS X 10.13.3;'
        }
      });
      response.on('end', () => {
        response.statusCode.should.equal(401);
        response.header('WWW-Authenticate').should.equal('Basic charset="UTF-8"');
        done();
      });
      sendError(Problem.user.insufficientRights(), request, response);
    });
  });

});

