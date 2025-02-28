const should = require('should');
const { DateTime } = require('luxon');
const { testService } = require('../setup');

describe('api: /sessions', () => {
  describe('POST', () => {
    if (process.env.TEST_AUTH === 'oidc') return; // no this.skip() available at Suite-level

    it('should return a new session if the information is valid', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'password4chelsea' })
        .expect(200)
        .then(({ body }) => {
          body.should.be.a.Session();
        })));

    // These demonstrate a strange feature of bcrypt - a valid password can be
    // repeated multiple times and still validate successfully.  An alternative
    // to these tests would be to check for NUL characters in supplied passwords
    // and reject them before passing the values to bcrypt.
    describe('weird bcrypt implementation details', () => {
      [
        [ 'repeated once',             'password4chelsea\0password4chelsea' ],                   // eslint-disable-line no-multi-spaces
        [ 'repeated twice',            'password4chelsea\0password4chelsea\0password4chelsea' ], // eslint-disable-line no-multi-spaces
        [ 'repeated until truncation', 'password4chelsea\0password4chelsea\0password4chelsea\0password4chelsea\0password4' ],
      ].forEach(([ description, password ]) => {
        it(`should treat a password ${description} as the singular version of the same`, testService((service) =>
          service.post('/v1/sessions')
            .send({ email: 'chelsea@getodk.org', password })
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Session();
            })));
      });
    });

    it('should treat email addresses case insensitively', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'cHeLsEa@getodk.OrG', password: 'password4chelsea' })
        .expect(200)
        .then(({ body }) => {
          body.should.be.a.Session();
        })));

    it('should provide a csrf token when the session returns', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'password4chelsea' })
        .expect(200)
        .then(({ body }) => {
          body.csrf.should.be.a.token();
        })));

    it('should set cookie information when the session returns', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'password4chelsea' })
        .expect(200)
        .then(({ body, headers }) => {
          // i don't know how this becomes an array but i think superagent does it.
          const cookie = headers['set-cookie'];

          const session = /^session=([^;]+); Path=\/; Expires=([^;]+); HttpOnly; SameSite=Strict$/.exec(cookie[0]);
          should.exist(session);
          decodeURIComponent(session[1]).should.equal(body.token);
          session[2].should.equal(DateTime.fromISO(body.expiresAt).toHTTP());

          const csrf = /^__csrf=([^;]+); Path=\/; Expires=([^;]+); SameSite=Strict$/.exec(cookie[1]);
          should.exist(csrf);
          decodeURIComponent(csrf[1]).should.equal(body.csrf);
          csrf[2].should.equal(DateTime.fromISO(body.expiresAt).toHTTP());
        })));

    it('should log the action in the audit log', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'password4alice' })
        .set('User-Agent', 'central/tests')
        .expect(200)
        .then(({ body }) => body.token)
        .then((token) => service.get('/v1/audits')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].actorId.should.equal(5);
            body[0].action.should.equal('user.session.create');
            body[0].actee.id.should.equal(5);
            body[0].details.userAgent.should.equal('central/tests');
          }))));

    [
      [ 'undefined',      undefined, 400, 'Required parameters missing. Expected (email, password), got (email: \'chelsea@getodk.org\', password: undefined).' ], // eslint-disable-line no-multi-spaces
      [ 'null',           null,      400, 'Required parameters missing. Expected (email, password), got (email: \'chelsea@getodk.org\', password: null).' ], // eslint-disable-line no-multi-spaces
      [ 'empty string',   '',        400, 'Required parameters missing. Expected (email, password), got (email: \'chelsea@getodk.org\', password: \'\').' ], // eslint-disable-line no-multi-spaces
      [ 'wrong password', 'letmein', 401, 'Could not authenticate with the provided credentials.' ], // eslint-disable-line no-multi-spaces
      [ 'number',         123,       401, 'Could not authenticate with the provided credentials.' ], // eslint-disable-line no-multi-spaces
      [ 'array',          [],        401, 'Could not authenticate with the provided credentials.' ], // eslint-disable-line no-multi-spaces
      [ 'object',         {},        401, 'Could not authenticate with the provided credentials.' ], // eslint-disable-line no-multi-spaces
    ].forEach(([ description, password, expectedStatus, expectedError ]) => {
      it(`should return a ${expectedStatus} for invalid password (${description})`, testService((service) =>
        service.post('/v1/sessions')
          .send({ email: 'chelsea@getodk.org', password })
          .expect(expectedStatus)
          .then(({ body }) => body.message.should.equal(expectedError))));
    });

    it('should return a 401 if the email is wrong', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'winnifred@getodk.org', password: 'winnifred' })
        .expect(401)
        .then(({ body }) => body.message.should.equal('Could not authenticate with the provided credentials.'))));

    it('should return a 400 if insufficient information is provided', testService((service) =>
      service.post('/v1/sessions')
        .expect(400)
        .then(({ body }) => body.details.should.eql({ expected: [ 'email', 'password' ], got: {} }))));
  });

  describe('/restore GET', () => {
    it('should fail if no valid session exists', testService((service) =>
      service.get('/v1/sessions/restore')
        .set('X-Forwarded-Proto', 'https')
        .set('Cookie', 'session: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .expect(404)));

    it('should return the active session if it exists', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.get('/v1/sessions/restore')
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', 'session=' + token)
          .expect(200)
          .then((restore) => {
            restore.body.should.be.a.Session();
            restore.body.token.should.equal(token);
          }))));
  });

  describe('/:token DELETE', () => {
    it('should return a 403 if the token does not exist', testService((service) =>
      service.delete('/v1/sessions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .expect(403)));

    it('should return a 403 if the user cannot delete the given token', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.login('chelsea', (asChelsea) =>
          asChelsea.delete('/v1/sessions/' + token).expect(403)))));

    it('should invalidate the token if successful', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.delete('/v1/sessions/' + token)
          .set('Authorization', 'Bearer ' + token)
          .expect(200)
          .then(() => service.get('/v1/users/current') // actually doesn't matter which route; we get 401 due to broken auth.
            .set('Authorization', 'Bearer ' + token)
            .expect(401)))));

    it('should log the action in the audit log if it is a field key', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token)
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=field_key.session.end')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
            })))));

    it('should allow non-admins to delete their own sessions', testService((service) =>
      service.authenticateUser('chelsea')
        .then((token) => service.delete('/v1/sessions/' + token)
          .set('Authorization', 'Bearer ' + token)
          .expect(200)
          .then(() => service.get('/v1/users/current') // actually doesn't matter which route; we get 401 due to broken auth.
            .set('Authorization', 'Bearer ' + token)
            .expect(401)))));

    it('should allow managers to delete project app user sessions', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/app-users')
          .send({ displayName: 'test app user' })
          .expect(200)
          .then(({ body }) => body.token)
          .then((token) => asBob.delete('/v1/sessions/' + token)
            .expect(200)
            .then(() => service.get(`/v1/key/${token}/users/current`)
              .expect(403))))));

    it('should allow managers to delete project public link sessions', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'test app user' })
          .expect(200)
          .then(({ body }) => body.token)
          .then((token) => asBob.delete('/v1/sessions/' + token)
            .expect(200)
            .then(() => service.get(`/v1/key/${token}/users/current`)
              .expect(403))))));

    it('should not allow app users to delete their own sessions', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/app-users')
          .send({ displayName: 'test app user' })
          .expect(200)
          .then(({ body }) => body.token)
          .then((token) => service.delete(`/v1/key/${token}/sessions/${token}`)
            .expect(403)))));

    it('should clear cookies if successful for the current session', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.delete('/v1/sessions/' + token)
          .set('Authorization', 'Bearer ' + token)
          .expect(200)
          .then(({ headers }) => {
            headers['set-cookie'].should.eql([
              'session=null; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
              '__csrf=null; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Strict'
            ]);
          }))));

    it('should not clear cookies if using some other session', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.login('alice', (asAlice) =>
          asAlice.delete('/v1/sessions/' + token)
            .expect(200)
            .then(({ headers }) => {
              should.not.exist(headers['set-cookie']);
            })))));

    it('should not log the action in the audit log for users', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.delete('/v1/sessions/' + token)
          .set('Authorization', 'Bearer ' + token)
          .expect(200)
          .then(() => service.login('alice', (asAlice) =>
            asAlice.get('/v1/audits')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(2);
                body[0].action.should.equal('user.session.create');
                body[1].action.should.equal('user.session.create');
              }))))));

    it('should log the action in the audit log for public links', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token)
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=public_link.session.end')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
            })))));

    it('should log the action in the audit log for app users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token)
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=field_key.session.end')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
            })))));
  });

  describe('/current DELETE', () => {
    it('should return a 404 if no token was specified', testService(service =>
      service.delete('/v1/sessions/current')
        .expect(404)));

    it('should invalidate the token if successful', testService(async (service) => {
      const token = await service.authenticateUser('alice');
      const { body } = await service.delete('/v1/sessions/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      body.should.eql({ success: true });
      await service.get('/v1/users/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }));

    it('should not allow app users to delete their own sessions', testService(async (service) => {
      const asBob = await service.login('bob');
      const { body: appUser } = await asBob.post('/v1/projects/1/app-users')
        .send({ displayName: 'test app user' })
        .expect(200);
      await service.delete(`/v1/key/${appUser.token}/sessions/current`)
        .expect(403);
    }));
  });

  // this isn't exactly the right place for this but i just want to check the
  // whole stack in addition to the unit tests.
  describe('cookie CSRF auth', () => {
    it('should reject if the CSRF token is missing', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.post('/v1/projects')
          .send({ name: 'my project' })
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', 'session=' + token)
          .expect(401))));

    it('should reject if the CSRF token is wrong', testService((service) =>
      service.authenticateUser('alice')
        .then((token) => service.post('/v1/projects')
          .send({ name: 'my project', __csrf: 'nope' })
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', 'session=' + token)
          .expect(401))));

    it('should succeed if the CSRF token is correct', testService((service) =>
      service.authenticateUser('alice', 'includeCsrf')
        .then((body) => service.post('/v1/projects')
          .send({ name: 'my project', __csrf: body.csrf })
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', 'session=' + body.token)
          .expect(200))));
  });
});

