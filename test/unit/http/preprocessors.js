const should = require('should');
const { createRequest, createResponse } = require('node-mocks-http');

const appRoot = require('app-root-path');
const preprocessors = require(appRoot + '/lib/http/preprocessors');
const { Context } = require(appRoot + '/lib/http/endpoint');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');
const crypto = require(appRoot + '/lib/util/crypto');
const { hashPassword } = crypto;

describe('preprocessors', () => {
  // some mock helpers to simplify testing this module in isolation:
  class Auth {
    constructor(data) { Object.assign(this, data); }
    session() { return Option.of(this._session); }
  }
  const mockSession = (expectedToken) => ({
    getByBearerToken: (token) => Promise.resolve((token === expectedToken)
      ? Option.of('session')
      : Option.none())
  });
  const mockUser = (expectedEmail, password) => ({
    getByEmail: (email) => Promise.resolve((email === expectedEmail)
      ? Option.of({ password, actor: 'actor' })
      : Option.none())
  });

  describe('sessionHandler', () => {
    const { sessionHandler } = preprocessors;

    it('should do nothing if no Authorization header is provided', () =>
      Promise.resolve(sessionHandler(
        { Auth, Session: mockSession() },
        new Context(createRequest({ fieldKey: Option.none() }))
      )).then((context) => {
        // preprocessors return nothing if they have no changes to make to the context.
        should.not.exist(context);
      }));

    it('should do nothing if Authorization mode is not Bearer or Basic', () =>
      Promise.resolve(sessionHandler(
        { Auth, Session: mockSession() },
        new Context(createRequest({ headers: { Authorization: 'Digest aabbccddeeff123' }, fieldKey: Option.none() }))
      )).then((context) => {
        // preprocessors return nothing if they have no changes to make to the context.
        should.not.exist(context);
      }));

    describe('Bearer auth', () => {
      it('should fail the request if Bearer auth is attempted with a successful auth present', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession() },
          new Context(
            createRequest({ headers: { Authorization: 'Bearer aabbccddeeff123' } }),
            { auth: { isAuthenticated() { return true; } } }
          )
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should fail the request if an invalid Bearer token is given', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(createRequest({ headers: { Authorization: 'Bearer abracadabra' } }))
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should set the appropriate session if a valid Bearer token is given', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(createRequest({ headers: { Authorization: 'Bearer alohomora' } }))
        )).then((context) => {
          context.auth._session.should.eql(Option.of('session'));
        }));
    });

    describe('Basic auth', () => {
      it('should reject non-https Basic auth requests', () =>
        Promise.resolve(sessionHandler(
          { Auth, User: mockUser('alice@opendatakit.org') },
          new Context(createRequest({ headers: { Authorization: 'Basic abracadabra' } }))
        )).should.be.rejectedWith(Problem, { problemCode: 401.3 }));

      it('should fail the request if an improperly-formatted Basic auth is given', () =>
        Promise.resolve(sessionHandler(
          { Auth, User: mockUser('alice@opendatakit.org') },
          new Context(createRequest({ headers: {
            Authorization: `Basic ${Buffer.from('alice@opendatakit.org:', 'utf8').toString('base64')}`,
            'X-Forwarded-Proto': 'https'
          } }))
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should fail the request if the Basic auth user cannot be found', () =>
        Promise.resolve(sessionHandler(
          { Auth, User: mockUser('alice@opendatakit.org') },
          new Context(createRequest({ headers: {
            Authorization: `Basic ${Buffer.from('bob@opendatakit.org:bob', 'utf8').toString('base64')}`,
            'X-Forwarded-Proto': 'https'
          } }))
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should fail the request if the Basic auth credentials are not right', () =>
        Promise.resolve(sessionHandler(
          { Auth, User: mockUser('alice@opendatakit.org', 'willnevermatch'), crypto },
          new Context(createRequest({ headers: {
            Authorization: `Basic ${Buffer.from('alice@opendatakit.org:alice', 'utf8').toString('base64')}`,
            'X-Forwarded-Proto': 'https'
          } }))
        )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

      it('should set the appropriate session if valid Basic auth credentials are given @slow', () =>
        hashPassword('alice').then((hashed) =>
          Promise.resolve(sessionHandler(
            { Auth, User: mockUser('alice@opendatakit.org', hashed), crypto },
            new Context(createRequest({ headers: {
              Authorization: `Basic ${Buffer.from('alice@opendatakit.org:alice', 'utf8').toString('base64')}`,
              'X-Forwarded-Proto': 'https'
            } }))
          )).then((context) => {
            context.auth._actor.should.equal('actor');
          })));
    });

    describe('by cookie', () => {
      it('should never try cookie auth over HTTP', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: { Cookie: '__Host-session=alohomora' } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          // preprocessors return nothing if they have no changes to make to the context.
          should.not.exist(context);
        }));

      it('should not throw an error if the cookie is invalid', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: 'please just let me in'
            } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          // preprocessors return nothing if they have no changes to make to the context.
          should.not.exist(context);
        }));

      it('should not throw an error if the token is invalid', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: '__Host-session=letmein'
            } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          // preprocessors return nothing if they have no changes to make to the context.
          should.not.exist(context);
        }));

      it('should do nothing if Cookie auth is attempted with primary auth present', () => {
        let caught = false;
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'Authorization': 'Bearer abc',
              'X-Forwarded-Proto': 'https',
              Cookie: '__Host-session=alohomora'
            } }),
            { auth: { isAuthenticated() { return false; } }, fieldKey: Option.none() }
          )
        )).catch((err) => {
          err.problemCode.should.equal(401.2);
          caught = true;
        }).then((context) => {
          caught.should.equal(true);
        });
      });

      it('should do nothing if Cookie auth is attempted with fk auth present', () => {
        let caught = false;
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(
            createRequest({
              method: 'GET',
              headers: {
                'Authorization': 'Bearer abc',
                'X-Forwarded-Proto': 'https',
                Cookie: '__Host-session=alohomora'
              },
              url: '/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            }),
            { auth: { isAuthenticated() { return false; } }, fieldKey: Option.none() }
          )
        )).catch((err) => {
          err.problemCode.should.equal(401.2);
          caught = true;
        }).then((context) => {
          caught.should.equal(true);
        });
      });

      it('should work for HTTPS GET requests', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(
            createRequest({ method: 'GET', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: '__Host-session=alohomora'
            } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          context.auth._session.should.eql(Option.of('session'));
        }));

      it('should work for HTTPS HEAD requests', () =>
        Promise.resolve(sessionHandler(
          { Auth, Session: mockSession('alohomora') },
          new Context(
            createRequest({ method: 'HEAD', headers: {
              'X-Forwarded-Proto': 'https',
              Cookie: '__Host-session=alohomora'
            } }),
            { fieldKey: Option.none() }
          )
        )).then((context) => {
          context.auth._session.should.eql(Option.of('session'));
        }));

      describe('CSRF protection', () => {
        const mockSessionWithCsrf = (expectedToken, csrf) => ({
          getByBearerToken: (token) => Promise.resolve((token === expectedToken)
            ? Option.of({ csrf })
            : Option.none())
        });

        it('should reject cookie auth without CSRF token for non-GET requests', () =>
          Promise.resolve(sessionHandler(
            { Auth, Session: mockSession('alohomora') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: '__Host-session=alohomora'
              } }),
              { fieldKey: Option.none() }
            )
          )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

        it('should reject cookie auth with incorrect CSRF token for non-GET requests', () =>
          Promise.resolve(sessionHandler(
            { Auth, Session: mockSessionWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: '__Host-session=alohomora'
              }, body: { __csrf: 'notsecretcsrf' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

        it('should do nothing on cookie auth with incorrect session token for non-GET requests', () =>
          Promise.resolve(sessionHandler(
            { Auth, Session: mockSessionWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: '__Host-session=notalohomora'
              }, body: { __csrf: 'secretcsrf' } }),
              { fieldKey: Option.none() }
            )
          )).then((context) => {
            // preprocessors return nothing if they have no changes to make to the context.
            should.not.exist(context);
          }));

        it('should accept cookie auth with correct CSRF token for non-GET requests', () =>
          Promise.resolve(sessionHandler(
            { Auth, Session: mockSessionWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: '__Host-session=alohomora'
              }, body: { __csrf: 'secretcsrf' } }),
              { fieldKey: Option.none() }
            )
          )).should.be.fulfilled());

        it('should remove CSRF token from data payload on success', () =>
          Promise.resolve(sessionHandler(
            { Auth, Session: mockSessionWithCsrf('alohomora', 'secretcsrf') },
            new Context(
              createRequest({ method: 'POST', headers: {
                'X-Forwarded-Proto': 'https',
                Cookie: '__Host-session=alohomora'
              }, body: { __csrf: 'secretcsrf', other: 'data' } }),
              { fieldKey: Option.none() }
            )
          )).then((context) => {
            context.body.should.eql({ other: 'data' });
          }));
      });
    });

    const mockFkSession = (expectedToken, actorType) => ({
      getByBearerToken: (token) => Promise.resolve((token === expectedToken)
        ? Option.of({ actor: { type: actorType }, token })
        : Option.none())
    });

    it('should do nothing if no fieldKey is present in context', () =>
      Promise.resolve(sessionHandler(
        { Auth, Session: mockFkSession('alohomora') },
        new Context(createRequest(), { fieldKey: Option.none() })
      )).then((context) => {
        // preprocessors return nothing if they have no changes to make to the context.
        should.not.exist(context);
      }));

    it('should fail the request if multiple auths are attempted', () =>
      Promise.resolve(sessionHandler(
        { Auth, Session: mockFkSession('alohomora') },
        new Context(createRequest(), {
          fieldKey: Option.of('alohomora'),
          auth: { isAuthenticated() { return true; } }
        })
      )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

    it('should fail the request if the session does not exist', () =>
      Promise.resolve(sessionHandler(
        { Auth, Session: mockFkSession('alohomora') },
        new Context(createRequest(), { fieldKey: Option.of('abracadabra'), })
      )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

    it('should fail the request if the session does not belong to a field key', () =>
      Promise.resolve(sessionHandler(
        { Auth, Session: mockFkSession('alohomora', 'user') },
        new Context(createRequest(), { fieldKey: Option.of('alohomora'), })
      )).should.be.rejectedWith(Problem, { problemCode: 401.2 }));

    it('should attach the correct auth if everything is correct', () =>
      Promise.resolve(sessionHandler(
        { Auth, Session: mockFkSession('alohomora', 'field_key') },
        new Context(createRequest(), { fieldKey: Option.of('alohomora'), })
      )).then((context) => {
        context.auth._session.should.eql({ actor: { type: 'field_key' }, token: 'alohomora' });
      }));
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

    it('should store uri-decoded query parameters in argData', () => {
      const request = createRequest({ method: 'GET', query: { type: 'xyz', q: 'test%20search' } });
      const result = queryOptionsHandler(null, new Context(request));
      result.queryOptions.argData.should.eql({ type: 'xyz', q: 'test search' });
    });

    it('should not story query parameters as allowed args', () => {
      const request = createRequest({ method: 'GET', query: { type: 'xyz', q: 'test%20search' } });
      const result = queryOptionsHandler(null, new Context(request));
      should.not.exist(result.queryOptions.args);
    });
  });
});

