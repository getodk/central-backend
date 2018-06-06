const should = require('should');
const { testService } = require('../setup');

describe('api: /users', () => {
  describe('GET', () => {
    it('should prohibit anonymous users from listing users', testService((service) =>
      service.get('/v1/users').expect(403)));

    it('should return a list of sorted users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users')
          .expect(200)
          .expect(({ body }) => {
            body.forEach((user) => user.should.be.a.User());
            body.map((user) => user.displayName).should.eql([ 'Alice', 'Bob', 'Chelsea' ]);
            body.map((user) => user.email).should.eql([ 'alice@opendatakit.org', 'bob@opendatakit.org', 'chelsea@opendatakit.org' ]);
          }))));
  });

  describe('POST', () => {
    it('should prohibit non-admins from creating users', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/users')
          .send({ email: 'david@opendatakit.org' })
          .expect(403))));

    it('should hash and store passwords if provided', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'david@opendatakit.org', password: 'apassword' })
          .expect(200)
          .then(() => service.login({ email: 'david@opendatakit.org', password: 'apassword' }, (asDavid) =>
            asDavid.get('/v1/users/current').expect(200))))));

    it('should not accept and hash blank passwords', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'david@opendatakit.org', password: '' })
          .expect(200)
          .then(() => service.login({ email: 'david@opendatakit.org', password: '' }, (failed) =>
            failed.get('/v1/users/current').expect(401))))));

    // TODO: this is for initial release /only!/ therefore also the check is a little
    // shallow since we don't have a capabilities/rights api yet, so we just see if
    // the new user can list users.
    it('should automatically make new users admins', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'david@opendatakit.org', password: 'david' })
          .expect(200)
          .then(() => service.login('david', (asDavid) =>
            asDavid.get('/v1/users').expect(200))))));

    it('should send an email to provisioned users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'david@opendatakit.org', password: 'david' })
          .expect(200)
          .then(() => {
            const email = global.inbox.pop();
            global.inbox.length.should.equal(0);
            email.to.should.eql([{ address: 'david@opendatakit.org', name: '' }]);
            email.subject.should.equal('ODK Central account created');
          }))));

    it('should send a token which can reset the new user password', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'david@opendatakit.org' })
          .expect(200)
          .then(() => {
            const token = /token=([^<]+)<\/p>/.exec(global.inbox.pop().html)[1];
            return service.post('/v1/users/reset/verify')
              .send({ new: 'testreset' })
              .set('Authorization', 'Bearer ' + token)
              .expect(200)
              .then(() => service.login({ email: 'david@opendatakit.org', password: 'testreset' }, (asDavid) =>
                asDavid.get('/v1/users/current').expect(200)));
          }))));

    // TODO: for initial release only:
    it('should duplicate the email into the display name if not given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'david@opendatakit.org' })
          .then(({ body }) => body.displayName.should.equal('david@opendatakit.org')))));
  });

  describe('/reset/initiate POST', () => {
    it('should send an email with a helpful message if no account exists', testService((service) =>
      service.post('/v1/users/reset/initiate')
        .send({ email: 'winnifred@opendatakit.org' })
        .expect(200)
        .then(() => {
          const email = global.inbox.pop();
          global.inbox.length.should.equal(0);
          email.to.should.eql([{ address: 'winnifred@opendatakit.org', name: '' }]);
          email.subject.should.equal('ODK Central account password reset');
          email.html.should.match(/no account exists/);
        })));

    it('should send an email with a token which can reset the user password', testService((service) =>
      service.post('/v1/users/reset/initiate')
        .send({ email: 'alice@opendatakit.org' })
        .expect(200)
        .then(() => {
          const email = global.inbox.pop();
          global.inbox.length.should.equal(0);
          email.to.should.eql([{ address: 'alice@opendatakit.org', name: '' }]);
          email.subject.should.equal('ODK Central account password reset');
          const token = /token=([^<]+)<\/p>/.exec(email.html)[1];

          return service.post('/v1/users/reset/verify')
            .send({ new: 'reset!' })
            .set('Authorization', 'Bearer ' + token)
            .expect(200)
            .then(() => service.login({ email: 'alice@opendatakit.org', password: 'reset!' }, (asAlice) =>
              asAlice.get('/v1/users/current').expect(200)));
        })));

    it('should not allow password reset token replay', testService((service) =>
      service.post('/v1/users/reset/initiate')
        .send({ email: 'alice@opendatakit.org' })
        .expect(200)
        .then(() => /token=([^<]+)<\/p>/.exec(global.inbox.pop().html)[1])
        .then((token) => service.post('/v1/users/reset/verify')
          .send({ new: 'reset!' })
          .set('Authorization', 'Bearer ' + token)
          .expect(200)
          .then(() => service.post('/v1/users/reset/verify')
            .send({ new: 'reset again!' })
            .set('Authorization', 'Bearer ' + token)
            .expect(401)))));

    it('should fail the request if invalidation is requested but not allowed', testService((service) =>
      service.post('/v1/users/reset/initiate?invalidate=true')
        .send({ email: 'alice@opendatakit.org' })
        .expect(403)));

    it('should invalidate the existing password if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users/reset/initiate?invalidate=true')
          .send({ email: 'bob@opendatakit.org' })
          .expect(200)
          .then(() => {
            // should still send the email.
            const email = global.inbox.pop();
            global.inbox.length.should.equal(0);
            email.to.should.eql([{ address: 'bob@opendatakit.org', name: '' }]);
            email.subject.should.equal('ODK Central account password reset');

            return service.post('/v1/sessions')
              .send({ email: 'bob@opendatakit.org', password: 'bob' })
              .expect(401);
          }))));

    it('should not allow a user to reset their own password directly', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users/reset/verify')
          .send({ new: 'coolpassword' })
          .expect(403))));
  });

  describe('/users/current GET', () => {
    it('should return not found if nobody is logged in', testService((service) =>
      service.get('/v1/users/current').expect(404)));

    it('should give the authed user if logged in', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => body.email.should.equal('chelsea@opendatakit.org')))));
  });

  describe('/users/:id GET', () => {
    it('should reject if the authed user cannot get', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => service.login('chelsea', (asChelsea) =>
            asChelsea.get(`/v1/users/${body.id}`).expect(403))))));

    it('should return the requested user', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => asAlice.get(`/v1/users/${body.id}`)
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.User();
              body.email.should.equal('alice@opendatakit.org');
            })))));

    it('should reject if the user does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/99').expect(404))));
  });
});

