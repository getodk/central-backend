const should = require('should');
const { createRequest, createResponse } = require('node-mocks-http');

const appRoot = require('app-root-path');
const middleware = require(appRoot + '/lib/http/middleware');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');
const { ExplicitPromise } = require(appRoot + '/lib/util/promise');
const { hashPassword } = require(appRoot + '/lib/util/crypto');

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
    const mockUser = (expectedEmail, password) => ({
      getByEmail: (email) => ExplicitPromise.of(Promise.resolve((email === expectedEmail)
        ? Option.of({ password, actor: 'actor' })
        : Option.none()))
    });

    it('should set no auth if no Authorization header is provided', (done) => {
      const request = createRequest();
      sessionParser({ Auth, Session: mockSession() })(request, null, () => {
        // this is a mock object so we have to directly check the properties.
        should.not.exist(request.auth._session);
        should.not.exist(request.auth._actor);
        done();
      });
    });

    it('should set no auth if Authorization mode is not Bearer or Basic', (done) => {
      const request = createRequest({ headers: { Authorization: 'Digest aabbccddeeff123' } });
      sessionParser({ Auth, Session: mockSession() })(request, null, () => {
        // this is a mock object so we have to directly check the properties.
        should.not.exist(request.auth._session);
        should.not.exist(request.auth._actor);
        done();
      });
    });

    it('should fail the request if Bearer auth is attempted with a successful auth present', (done) => {
      const request = createRequest({ headers: { Authorization: 'Bearer aabbccddeeff123' } });
      request.auth = { isAuthenticated: () => true };
      sessionParser({ Auth, Session: mockSession() })(request, null, (failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(401.2);
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
        request.auth._session.should.eql(Option.of('session'));
        done();
      });
    });

    it('should reject non-https Basic auth requests', (done) => {
      const request = createRequest({ headers: { Authorization: 'Basic abracadabra', } });
      sessionParser({ Auth, User: mockUser('alice@opendatakit.org') })(request, null, (failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(401.3);
        done();
      });
    });

    it('should fail the request if an improperly-formatted Basic auth is given', (done) => {
      const encodedCredentials = Buffer.from('alice@opendatakit.org:', 'utf8').toString('base64');
      const request = createRequest({ headers: {
        Authorization: `Basic ${encodedCredentials}`,
        'X-Forwarded-Proto': 'https'
      } });
      sessionParser({ Auth, User: mockUser('alice@opendatakit.org') })(request, null, (failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(401.2);
        done();
      });
    });

    it('should fail the request if Basic auth is attempted with a successful auth present @slow', (done) => {
      hashPassword('alice').point().then((hashed) => {
        const encodedCredentials = Buffer.from('alice@opendatakit.org:alice', 'utf8').toString('base64');
        const request = createRequest({ headers: {
          Authorization: `Basic ${encodedCredentials}`,
          'X-Forwarded-Proto': 'https'
        } });
        request.auth = { isAuthenticated: () => true };
        sessionParser({ Auth, User: mockUser('alice@opendatakit.org', hashed) })(request, null, (failure) => {
          failure.isProblem.should.equal(true);
          failure.problemCode.should.equal(401.2);
          done();
        });
      });
    });

    it('should fail the request if the Basic auth user cannot be found', (done) => {
      const encodedCredentials = Buffer.from('bob@opendatakit.org:bob', 'utf8').toString('base64');
      const request = createRequest({ headers: {
        Authorization: `Basic ${encodedCredentials}`,
        'X-Forwarded-Proto': 'https'
      } });
      sessionParser({ Auth, User: mockUser('alice@opendatakit.org') })(request, null, (failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(401.2);
        done();
      });
    });

    it('should fail the request if the Basic auth credentials are not right', (done) => {
      const encodedCredentials = Buffer.from('alice@opendatakit.org:password', 'utf8').toString('base64');
      const request = createRequest({ headers: {
        Authorization: `Basic ${encodedCredentials}`,
        'X-Forwarded-Proto': 'https'
      } });
      sessionParser({ Auth, User: mockUser('alice@opendatakit.org', 'willnevermatch') })(request, null, (failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(401.2);
        done();
      });
    });

    it('should set the appropriate session if valid Basic auth credentials are given @slow', (done) => {
      hashPassword('alice').point().then((hashed) => {
        const encodedCredentials = Buffer.from('alice@opendatakit.org:alice', 'utf8').toString('base64');
        const request = createRequest({ headers: {
          Authorization: `Basic ${encodedCredentials}`,
          'X-Forwarded-Proto': 'https'
        } });
        sessionParser({ Auth, User: mockUser('alice@opendatakit.org', hashed) })(request, null, () => {
          request.auth._actor.should.equal('actor');
          done();
        });
      });
    });
  });
});

