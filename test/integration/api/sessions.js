const should = require('should');
const { DateTime } = require('luxon');
const { testService } = require('../setup');

describe('api: /sessions', () => {
  describe('POST', () => {
    it('should return a new session if the information is valid', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'chelsea' })
        .expect(200)
        .then(({ body }) => {
          body.should.be.a.Session();
        })));

    it('should treat email addresses case insensitively', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'cHeLsEa@gEtOdK.OrG', password: 'chelsea' })
        .expect(200)
        .then(({ body }) => {
          body.should.be.a.Session();
        })));

    it('should provide a csrf token when the session returns', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'chelsea' })
        .expect(200)
        .then(({ body }) => {
          body.csrf.should.be.a.token();
        })));

    it('should set cookie information when the session returns', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'chelsea' })
        .expect(200)
        .then(({ body, headers }) => {
          // i don't know how this becomes an array but i think superagent does it.
          const cookie = headers['set-cookie'];

          const session = /__Host-session=([^;]+); Path=\/; Expires=([^;]+); HttpOnly; Secure; SameSite=Strict/.exec(cookie[0]);
          should.exist(session);
          decodeURIComponent(session[1]).should.equal(body.token);
          session[2].should.equal(DateTime.fromISO(body.expiresAt).toHTTP());

          const csrf = /__csrf=([^;]+); Path=\/; Expires=([^;]+); Secure; SameSite=Strict/.exec(cookie[1]);
          should.exist(csrf);
          decodeURIComponent(csrf[1]).should.equal(body.csrf);
          csrf[2].should.equal(DateTime.fromISO(body.expiresAt).toHTTP());
        })));

    it('should return a 401 if the password is wrong', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'letmein' })
        .expect(401)
        .then(({ body }) => body.message.should.equal('Could not authenticate with the provided credentials.'))));

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
        .set('Cookie', '__Host-session: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .expect(404)));

    it('should return the active session if it exists', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => service.get('/v1/sessions/restore')
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', '__Host-session=' + body.token)
          .expect(200)
          .then((restore) => {
            restore.body.should.be.a.Session();
            restore.body.token.should.equal(body.token);
          }))));
  });

  describe('/:token DELETE', () => {
    it('should return a 403 if the token does not exist', testService((service) =>
      service.delete('/v1/sessions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .expect(403)));

    it('should return a 403 if the user cannot delete the given token', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => {
          const token = body.token;
          return service.login('chelsea', (asChelsea) =>
            asChelsea.delete('/v1/sessions/' + token).expect(403));
        })));

    it('should invalidate the token if successful', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => {
          const token = body.token;
          return service.delete('/v1/sessions/' + token)
            .set('Authorization', 'Bearer ' + token)
            .expect(200)
            .then(() => service.get('/v1/users/current') // actually doesn't matter which route; we get 401 due to broken auth.
              .set('Authorization', 'Bearer ' + token)
              .expect(401));
        })));

    it('should log the action in the audit log if it is a field key', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token)
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=session.end')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
            })))));

    it('should allow non-admins to delete their own sessions', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@getodk.org', password: 'chelsea' })
        .expect(200)
        .then(({ body }) => {
          const token = body.token;
          return service.delete('/v1/sessions/' + token)
            .set('Authorization', 'Bearer ' + token)
            .expect(200)
            .then(() => service.get('/v1/users/current') // actually doesn't matter which route; we get 401 due to broken auth.
              .set('Authorization', 'Bearer ' + token)
              .expect(401));
        })));

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

    it('should clear the cookie if successful for the current session', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => {
          const token = body.token;
          return service.delete('/v1/sessions/' + token)
            .set('Authorization', 'Bearer ' + token)
            .expect(200)
            .then(({ headers }) => {
              const cookie = headers['set-cookie'][0];
              cookie.should.match(/__Host-session=null/);
            });
        })));

    it('should not clear the cookie if using some other session', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => body.token)
        .then((token) => service.login('alice', (asAlice) =>
          asAlice.delete('/v1/sessions/' + token)
            .expect(200)
            .then(({ headers }) => {
              should.not.exist(headers['set-cookie']);
            })))));

    it('should not log the action in the audit log for users', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => body.token)
        .then((token) => service.delete('/v1/sessions/' + token)
          .set('Authorization', 'Bearer ' + token)
          .expect(200)
          .then(() => service.login('alice', (asAlice) =>
            asAlice.get('/v1/audits?action=session.end')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(0);
              }))))));

    it('should log the action in the audit log for public links', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token)
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=session.end')
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
          .then(() => asAlice.get('/v1/audits?action=session.end')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
            })))));
  });

  // this isn't exactly the right place for this but i just want to check the
  // whole stack in addition to the unit tests.
  describe('cookie CSRF auth', () => {
    it('should reject if the CSRF token is missing', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => service.post('/v1/projects')
          .send({ name: 'my project' })
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', '__Host-session=' + body.token)
          .expect(401))));

    it('should reject if the CSRF token is wrong', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => service.post('/v1/projects')
          .send({ name: 'my project', __csrf: 'nope' })
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', '__Host-session=' + body.token)
          .expect(401))));

    it('should succeed if the CSRF token is correct', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@getodk.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => service.post('/v1/projects')
          .send({ name: 'my project', __csrf: body.csrf })
          .set('X-Forwarded-Proto', 'https')
          .set('Cookie', '__Host-session=' + body.token)
          .expect(200))));
  });
});

