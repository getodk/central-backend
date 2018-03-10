const should = require('should');
const { createRequest, createResponse } = require('node-mocks-http');

const appRoot = require('app-root-path');
const middleware = require(appRoot + '/lib/http/middleware');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');
const { ExplicitPromise } = require(appRoot + '/lib/util/promise');

describe('middleware', () => {
  describe('versionParser', () => {
    const { versionParser } = middleware;
    it('should fallthrough to the error handler if no version is present', (done) => {
      const request = createRequest({ url: '/hello/test/v1' });
      versionParser(request, null, (error) => {
        error.isProblem.should.equal(true);
        error.problemCode.should.equal(404.2);
        done();
      });
    });

    it('should fallthrough to the error handler if the version is wrong', (done) => {
      const request = createRequest({ url: '/v4/users' });
      versionParser(request, null, (error) => {
        error.isProblem.should.equal(true);
        error.problemCode.should.equal(404.3);
        error.problemDetails.got.should.equal('4');
        done();
      });
    });

    it('should strip off the version before calling next', (done) => {
      const request = createRequest({ url: '/v1/users/23' });
      versionParser(request, null, () => {
        request.url.should.equal('/users/23');
        done();
      });
    });

    it('should supply a numeric representation of the received number under request', (done) => {
      const request = createRequest({ url: '/v1/forms/testform/submissions' });
      versionParser(request, null, () => {
        request.apiVersion.should.equal(1);
        done();
      });
    });
  });

  describe('sessionParser', () => {
    const { sessionParser } = middleware;

    // some mock helpers to simplify testing this module in isolation:
    class Auth { constructor(data) { Object.assign(this, data); } }
    const mockSession = (expectedToken) => ({
      getByBearerToken: (token) => ExplicitPromise.of(Promise.resolve((token === expectedToken)
        ? Option.of('session')
        : Option.none()))
    });

    it('should set no-session if no Authorization header is provided', (done) => {
      const request = createRequest();
      sessionParser({ Auth, Session: mockSession() })(request, null, () => {
        request.auth.session.should.equal(Option.none());
        done();
      });
    });

    it('should set no-session if Authorization mode is no Bearer', (done) => {
      const request = createRequest({ headers: { Authorization: 'Basic aabbccddeeff123' } });
      sessionParser({ Auth, Session: mockSession() })(request, null, () => {
        request.auth.session.should.equal(Option.none());
        done();
      });
    });

    it('should fail the request if an invalid Bearer token is given', (done) => {
      const request = createRequest({ headers: { Authorization: 'Bearer abracadabra' } });
      sessionParser({ Auth, Session: mockSession('alohomora') })(request, null, (failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(401.2);
        done();
      });
    });

    it('should set the appropriate session if a valid Bearer token is given', (done) => {
      const request = createRequest({ headers: { Authorization: 'Bearer alohomora' } });
      sessionParser({ Auth, Session: mockSession('alohomora') })(request, null, () => {
        request.auth.session.should.eql(Option.of('session'));
        done();
      });
    });
  });
});

