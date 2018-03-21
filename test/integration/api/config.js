const should = require('should');
const { testService } = require('../setup');

describe('api: /config', () => {
  describe('/backups', () => {
    describe('GET', () => {
      it('should reject unless the user can see backup config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/config/backups').expect(403))));

      it('should return not found if backups are not configured', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/config/backups').expect(404))));

      it('should return backup config details if configured', testService((service, { Config }, finalize) =>
        finalize(Config.set('backups.main', '{"type":"google"}'))
          .then(() => service.login('alice', (asAlice) =>
            asAlice.get('/v1/config/backups')
              .expect(200)
              .then(({ body }) => {
                body.config.should.eql({ type: 'google' });
                (body.latest == null).should.equal(true);
              })))));

      it('should return latest result if logged', testService((service, { all, Audit, Config }, finalize) =>
        finalize(all.inOrder([
          Config.set('backups.main', '{"type":"google"}'),
          Audit.log(null, 'backup', null, { order: 'first' }),
          Audit.log(null, 'backup', null, { order: 'second' })
        ])).then(() => service.login('alice', (asAlice) =>
          asAlice.get('/v1/config/backups')
            .expect(200)
            .then(({ body }) => {
              body.config.should.eql({ type: 'google' });
              body.latest.details.should.eql({ order: 'second' });
              body.latest.loggedAt.should.be.a.recentIsoDate();
            })))));
    });

    describe('DELETE', () => {
      it('should reject unless the user can terminate backups', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.delete('/v1/config/backups').expect(403))));

      it('should return success even if no config is set', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/config/backups').expect(200))));

      it('should clear the config if it exists', testService((service, { Config }, finalize) =>
        finalize(Config.set('backups.main', '{"type":"google"}'))
          .then(() => service.login('alice', (asAlice) =>
            asAlice.delete('/v1/config/backups')
              .expect(200)
              .then(() => asAlice.get('/v1/config/backups').expect(404))))));
    });

    describe('/initiate POST', () => {
      it('should reject unless the user can create backups', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.post('/v1/config/backups/initiate').expect(403))));

      it('should return a redirect URL and auth token', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups/initiate')
            .send({ passphrase: 'super secure' })
            .expect(200)
            .then(({ body }) => {
              body.url.should.match(/^https:\/\/accounts.google.com\/o\/oauth2/);
              body.token.should.be.a.token();
            }))));
    });
  });
});

