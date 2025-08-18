const should = require('should');
const { createRequest } = require('../../util/node-mocks-http');

const appRoot = require('app-root-path');
const preprocessors = require(appRoot + '/lib/http/preprocessors');
const { Context } = require(appRoot + '/lib/http/endpoint');
const { Session, User, Actor } = require(appRoot + '/lib/model/frames');
const { by } = require(appRoot + '/lib/model/query/auth');
const { hashPassword } = require(appRoot + '/lib/util/crypto');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');

describe('preprocessors', () => {
  // some mock helpers to simplify testing this module in isolation:
  const Auth = { by: (x) => by(x)({}) };
  const mockSessions = (expectedToken) => ({
    getByBearerToken: (token) => Promise.resolve((token === expectedToken)
      ? Option.of(new Session({ test: 'session' }))
      : Option.none())
  });
  const mockUsers = (expectedEmail, password) => ({
    getByEmail: (email) => Promise.resolve((email === expectedEmail)
      ? Option.of(new User({ password }, { actor: new Actor({ displayName: 'test' }) }))
      : Option.none())
  });

  describe('authHandler', () => {
    const { authHandler } = preprocessors;

    it('should reject if no Authorization header is provided', () =>
      Promise.resolve(authHandler(
        { Auth, Sessions: mockSessions() },
        new Context(createRequest({ fieldKey: Option.none() }))
      )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

    it('should fail the request if unsupported Authorization header is supplied', () =>
      Promise.resolve(authHandler(
        { Auth, Sessions: mockSessions() },
        new Context(createRequest({ headers: { Authorization: 'Digest aabbccddeeff123' }, fieldKey: Option.none() }))
      )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

    describe('Bearer auth', () => {
      it('should ignore bearer auth if a field key is present', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: {
            getByBearerToken: (token) => {
              token.should.not.equal('aabbccddeeff123');
              return Promise.resolve(Option.none());
            }
          } },
          new Context(
            createRequest({ headers: { Authorization: 'Bearer aabbccddeeff123' } }),
            { auth: { isAuthenticated() { return true; } }, fieldKey: Option.of('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 403.1 }));

      it('should fail the request if an invalid Bearer token is given', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ headers: { Authorization: 'Bearer abracadabra' } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should set the appropriate session if a valid Bearer token is given', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ headers: { Authorization: 'Bearer alohomora' } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          context.auth.session.should.eql(Option.of(new Session({ test: 'session' })));
        }));
    });

    describe('Basic auth', () => {
      it('should reject non-https Basic auth requests', () =>
        Promise.resolve(authHandler(
          { Auth, Users: mockUsers('alice@getodk.org') },
          new Context(
            createRequest({ headers: { Authorization: 'Basic abracadabra' } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.3 }));

      it('should fail the request if an improperly-formatted Basic auth is given', () =>
        Promise.resolve(authHandler(
          { Auth, Users: mockUsers('alice@getodk.org') },
          new Context(
            createRequest({ headers: {
              Authorization: `Basic ${Buffer.from('alice@getodk.org:', 'utf8').toString('base64')}`,
              'X-Forwarded-Proto': 'https'
            } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should fail the request if the Basic auth user cannot be found', () =>
        Promise.resolve(authHandler(
          { Auth, Users: mockUsers('alice@getodk.org') },
          new Context(
            createRequest({ headers: {
              Authorization: `Basic ${Buffer.from('bob@getodk.org:bob', 'utf8').toString('base64')}`,
              'X-Forwarded-Proto': 'https'
            } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should fail the request if the Basic auth credentials are not right', () =>
        Promise.resolve(authHandler(
          { Auth, Users: mockUsers('alice@getodk.org', 'willnevermatch') },
          new Context(
            createRequest({ headers: {
              Authorization: `Basic ${Buffer.from('alice@getodk.org:alice', 'utf8').toString('base64')}`,
              'X-Forwarded-Proto': 'https'
            } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should set the appropriate session if valid Basic auth credentials are given @slow', () =>
        hashPassword('password4alice').then((hashed) =>
          Promise.resolve(authHandler(
            { Auth, Users: mockUsers('alice@getodk.org', hashed) },
            new Context(
              createRequest({ headers: {
                Authorization: `Basic ${Buffer.from('alice@getodk.org:password4alice', 'utf8').toString('base64')}`,
                'X-Forwarded-Proto': 'https'
              } }),
              { fieldKey: Option.none() }
            )
          )).then((context) => {
            context.auth.actor.should.eql(Option.of(new Actor({ displayName: 'test' })));
          })));
    });

    describe('by cookie', () => {
      it('should never try cookie auth over HTTP', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: { Cookie: 'session=alohomora' }, cookies: { session: 'alohomora' } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.3 }));

      it('should throw an error if the cookie is invalid', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: 'please just let me in'
            }, cookies: {} }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should throw an error if the token is invalid', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: 'session=letmein'
            }, cookies: { session: 'letmein' } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should throw an error if the cookie is there without session', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: 'device=abc'
            }, cookies: { device: 'abc' } }),
            { fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should prioritise primary auth over Cookie auth', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              // eslint-disable-next-line quote-props
              'Authorization': 'Bearer abc',
              'X-Forwarded-Proto': 'https',
              Cookie: 'session=alohomora'
            }, cookies: { session: 'alohomora' } }),
            { auth: { isAuthenticated() { return false; } }, fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should prioritise fk auth over Cookie auth', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({
              method: 'GET',
              headers: {
                // eslint-disable-next-line quote-props
                'Authorization': 'Bearer abc',
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=alohomora'
              },
              cookies: { session: 'alohomora' },
              url: '/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            }),
            { auth: { isAuthenticated() { return false; } }, fieldKey: Option.none() }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should work for HTTPS GET requests', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: 'session=alohomora'
            }, cookies: { session: 'alohomora' } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          context.auth.session.should.eql(Option.of(new Session({ test: 'session' })));
        }));

      it('should work for HTTPS HEAD requests', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('alohomora') },
          new Context(
            createRequest({ method: 'HEAD', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: 'session=alohomora'
            }, cookies: { session: 'alohomora' } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          context.auth.session.should.eql(Option.of(new Session({ test: 'session' })));
        }));

      it('should decode encoded cookies', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockSessions('aloho$mora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: 'session=aloho%24mora'
            }, cookies: { session: 'aloho$mora' } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          context.auth.session.should.eql(Option.of(new Session({ test: 'session' })));
        }));

      describe('CSRF protection', () => {
        const mockSessionsWithCsrf = (expectedToken, csrf) => ({
          getByBearerToken: (token) => Promise.resolve((token === expectedToken)
            ? Option.of(new Session({ csrf }))
            : Option.none())
        });

        it('should reject cookie auth without CSRF token for non-GET requests', () =>
          Promise.resolve(authHandler(
            { Auth, Sessions: mockSessions('alohomora') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=alohomora'
              }, cookies: { session: 'alohomora' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

        it('should reject cookie auth with incorrect CSRF token for non-GET requests', () =>
          Promise.resolve(authHandler(
            { Auth, Sessions: mockSessionsWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=alohomora'
              }, body: { __csrf: 'notsecretcsrf' }, cookies: { session: 'alohomora' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

        it('should reject cookie auth with invalid CSRF token for non-GET requests', () =>
          Promise.resolve(authHandler(
            { Auth, Sessions: mockSessionsWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=alohomora'
              }, body: { __csrf: '%ea' }, cookies: { session: 'alohomora' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

        it('should reject cookie auth with incorrect session token', () =>
          Promise.resolve(authHandler(
            { Auth, Sessions: mockSessionsWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=notalohomora'
              }, body: { __csrf: 'secretcsrf' }, cookies: { session: 'notalohomora' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

        it('should accept cookie auth with correct CSRF token for non-GET requests', () =>
          Promise.resolve(authHandler(
            { Auth, Sessions: mockSessionsWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=alohomora'
              }, body: { __csrf: 'secretcsrf' }, cookies: { session: 'alohomora' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.fulfilled());

        it('should url-decode the CSRF token', () =>
          Promise.resolve(authHandler(
            { Auth, Sessions: mockSessionsWithCsrf('alohomora', 'secret$csrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=alohomora'
              }, body: { __csrf: 'secret%24csrf' }, cookies: { session: 'alohomora' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.fulfilled());

        it('should remove CSRF token from data payload on success', () =>
          Promise.resolve(authHandler(
            { Auth, Sessions: mockSessionsWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: 'session=alohomora'
              }, body: { __csrf: 'secretcsrf', other: 'data' }, cookies: { session: 'alohomora' } }),
              { fieldKey: Option.none() }
            )
          )).then((context) => {
            context.body.should.eql({ other: 'data' });
          }));
      });
    });

    describe('fk auth', () => {
      const mockFkSession = (expectedToken, actorType) => ({
        getByBearerToken: (token) => Promise.resolve((token === expectedToken)
          ? Option.of(new Session({ token }, { actor: new Actor({ type: actorType }) }))
          : Option.none())
      });

      it('should fail the request with 401 if the token is the wrong length', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockFkSession('alohomor') },
          new Context(createRequest(), { fieldKey: Option.of('alohomora'), })
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should fail the request with 403 if the session does not exist', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockFkSession('alohomoraalohomoraalohomoraalohomoraalohomoraalohomoraalohomoraa') },
          new Context(createRequest(), { fieldKey: Option.of('abracadabraabracadabraabracadabraabracadabraabracadabraabracadab'), })
        )).should.be.rejectedWith(Problem, { problemCode: 403.1 }));

      it('should fail the request with 403 if the session does not belong to a field key', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockFkSession('alohomoraalohomoraalohomoraalohomoraalohomoraalohomoraalohomoraa', 'user') },
          new Context(createRequest(), { fieldKey: Option.of('alohomoraalohomoraalohomoraalohomoraalohomoraalohomoraalohomoraa'), })
        )).should.be.rejectedWith(Problem, { problemCode: 403.1 }));

      it('should attach the correct auth if everything is correct', () =>
        Promise.resolve(authHandler(
          { Auth, Sessions: mockFkSession('alohomoraalohomoraalohomoraalohomoraalohomoraalohomoraalohomoraa', 'field_key') },
          new Context(createRequest(), { fieldKey: Option.of('alohomoraalohomoraalohomoraalohomoraalohomoraalohomoraalohomoraa'), })
        )).then((context) => {
          context.auth.session.should.eql(Option.of(new Session({
            token: 'alohomoraalohomoraalohomoraalohomoraalohomoraalohomoraalohomoraa'
          })));
          context.auth.actor.should.eql(Option.of(new Actor({ type: 'field_key' })));
        }));
    });
  });

  describe('queryOptionsHandler', () => {
    const { queryOptionsHandler } = preprocessors;
    it('should set extended if the header is given', () => {
      const request = createRequest({ method: 'GET', headers: { 'X-Extended-Metadata': 'true' } });
      const result = queryOptionsHandler(null, new Context(request));
      result.queryOptions.extended.should.equal(true);
    });

    it('should set extended to false given false', () => {
      const request = createRequest({ method: 'GET', headers: { 'X-Extended-Metadata': 'false' } });
      const result = queryOptionsHandler(null, new Context(request));
      result.queryOptions.extended.should.equal(false);
    });

    it('should set extended to false given nothing', () => {
      const request = createRequest({ method: 'GET' });
      const result = queryOptionsHandler(null, new Context(request));
      result.queryOptions.extended.should.equal(false);
    });

    it('should set offset if a value is given', () => {
      const request = createRequest({ method: 'GET', query: { offset: '42' } });
      const result = queryOptionsHandler(null, new Context(request));
      result.queryOptions.offset.should.equal(42);
    });

    it('should set no offset if no value is given', () => {
      const request = createRequest({ method: 'GET', query: { offset: null } });
      const result = queryOptionsHandler(null, new Context(request));
      should(result.queryOptions.offset).equal(undefined);
    });

    it('should throw an error if a non-numeric offset is given', () => {
      const request = createRequest({ method: 'GET', query: { offset: 'abc' } });
      return queryOptionsHandler(null, new Context(request))
        .should.be.rejected()
        .then((error) => {
          error.problemCode.should.equal(400.11);
          error.problemDetails.should.eql({ field: 'offset', expected: 'integer' });
        });
    });

    it('should set limit if a value is given', () => {
      const request = createRequest({ method: 'GET', query: { limit: '42' } });
      const result = queryOptionsHandler(null, new Context(request));
      result.queryOptions.limit.should.equal(42);
    });

    it('should set no limit if no value is given', () => {
      const request = createRequest({ method: 'GET', query: { limit: null } });
      const result = queryOptionsHandler(null, new Context(request));
      should(result.queryOptions.limit).equal(undefined);
    });

    it('should throw an error if a non-numeric limit is given', () => {
      const request = createRequest({ method: 'GET', query: { limit: 'abc' } });
      return queryOptionsHandler(null, new Context(request))
        .should.be.rejected()
        .then((error) => {
          error.problemCode.should.equal(400.11);
          error.problemDetails.should.eql({ field: 'limit', expected: 'integer' });
        });
    });

    it('should not re-decode query parameters in argData', () => {
      const request = createRequest({ method: 'GET', query: { type: 'xyz', q: 'test%20search' } });
      const result = queryOptionsHandler(null, new Context(request));
      result.queryOptions.argData.should.eql({ type: 'xyz', q: 'test%20search' });
    });

    it('should not store query parameters as allowed args', () => {
      const request = createRequest({ method: 'GET', query: { type: 'xyz', q: 'test%20search' } });
      const result = queryOptionsHandler(null, new Context(request));
      should.not.exist(result.queryOptions.args);
    });
  });
});

