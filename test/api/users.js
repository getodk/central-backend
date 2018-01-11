const should = require('should');
const { testService, as } = require('./setup');
const { shouldBeDate, couldBeDate } = require('./util');

describe('api: /users', () => {
  describe('GET', () => {
    it('should prohibit anonymous users from listing users', testService((service) =>
      service.get('/v1/users').expect(403)));

    it('should return a list of sorted users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users')
          .expect(200)
          .expect(({ body }) => {
            body
              .map(shouldBeDate('createdAt'))
              .map(couldBeDate('updatedAt'))
              .should.eql([
                { displayName: 'Alice', email: 'alice@opendatakit.org', id: 4, meta: null },
                { displayName: 'Bob', email: 'bob@opendatakit.org', id: 5, meta: null },
                { displayName: 'Chelsea', email: 'chelsea@opendatakit.org', id: 6, meta: null }
              ]);
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
            email.to.should.eql([{ address: 'david@opendatakit.org', name: '' }]);
            email.subject.should.equal('Data collection account created');
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
  });

  describe('/reset/initiate POST', () => {
    it('should send an email with a helpful message if no account exists', testService((service) =>
      service.post('/v1/users/reset/initiate')
        .send({ email: 'winnifred@opendatakit.org' })
        .expect(200)
        .then(() => {
          const email = global.inbox.pop();
          email.to.should.eql([{ address: 'winnifred@opendatakit.org', name: '' }]);
          email.subject.should.equal('Data collection account password reset');
          email.html.should.match(/no account exists/);
        })));

    it('should send an email with a token which can reset the user password', testService((service) =>
      service.post('/v1/users/reset/initiate')
        .send({ email: 'alice@opendatakit.org' })
        .expect(200)
        .then(() => {
          const email = global.inbox.pop();
          email.to.should.eql([{ address: 'alice@opendatakit.org', name: '' }]);
          email.subject.should.equal('Data collection account password reset');
          const token = /token=([^<]+)<\/p>/.exec(email.html)[1];

          return service.post('/v1/users/reset/verify')
            .send({ new: 'reset!' })
            .set('Authorization', 'Bearer ' + token)
            .expect(200)
            .then(() => service.login({ email: 'alice@opendatakit.org', password: 'reset!' }, (asAlice) =>
              asAlice.get('/v1/users/current').expect(200)));
        })));

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
});

