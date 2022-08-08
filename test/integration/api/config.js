const appRoot = require('app-root-path');
const should = require('should');
const { map } = require('ramda');
// eslint-disable-next-line import/no-dynamic-require
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
const { testService } = require('../setup');

describe('api: /config', () => {
  describe('generic endpoints', () => {
    describe('POST', () => {
      it('should reject if the user cannot set config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(403))));

      it('should reject if the config cannot be directly set', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups.main')
            .send({ type: 'google' })
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.8);
            }))));

      it('should reject for an unknown config', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/unknown')
            .send({ foo: 'bar' })
            .expect(400))));

      it('should set the config', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Config();
              body.key.should.equal('analytics');
              body.value.should.eql({ enabled: true });
              body.setAt.should.be.a.recentIsoDate();
            }))));

      it('should call fromValue for the config frame', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/analytics')
            .send({ enabled: false, email: 'alice@getodk.org' })
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Config();
              // `email` is only set when `enabled` is `true`.
              body.value.should.eql({ enabled: false });
            }))));

      it('should overwrite the existing config', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(200)
            .then(() => asAlice.post('/v1/config/analytics')
              .send({ enabled: false })
              .expect(200)
              .then(({ body }) => {
                body.value.enabled.should.be.false();
              })))));

      it('should log the action in the audit log', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(200)
            .then(() => asAlice.get('/v1/audits?action=config.set')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].actorId.should.equal(5);
                should.not.exist(body[0].acteeId);
                body[0].details.should.eql({
                  key: 'analytics',
                  value: { enabled: true }
                });
              })))));
    });

    describe('GET', () => {
      it('should reject if the user cannot set config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/config/analytics').expect(403))));

      it('should return notfound if the config is not set', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/config/analytics').expect(404))));

      it('should return the config', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(200)
            .then(() => asAlice.get('/v1/config/analytics')
              .expect(200)
              .then(({ body }) => {
                body.should.be.a.Config();
                body.key.should.equal('analytics');
                body.value.should.eql({ enabled: true });
                body.setAt.should.be.a.recentIsoDate();
              })))));

      it('should transform the config value', testService((service, { Configs }) =>
        Configs.set('backups.main', { type: 'google', keys: { super: 'secret' } })
          .then(() => service.login('alice', (asAlice) =>
            asAlice.get('/v1/config/backups.main')
              .expect(200)
              .then(({ body }) => {
                body.should.be.a.Config();
                // No keys
                body.value.should.eql({ type: 'google' });
              })))));
    });

    describe('DELETE', () => {
      it('should reject if the user cannot set config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.delete('/v1/config/analytics').expect(403))));

      it('should reject if the config cannot be directly set', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/config/backups.main')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.8);
            }))));

      it('should reject for an unknown config', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/config/unknown').expect(400))));

      it('should unset the config', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(200)
            .then(() => asAlice.delete('/v1/config/analytics')
              .expect(200)
              .then(({ body }) => {
                body.should.eql({ success: true });
              }))
            .then(() => asAlice.get('/v1/config/analytics')
              .expect(404)))));

      it('should return success even if no config is set', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/config/analytics').expect(200))));

      it('should log the action in the audit log', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(200)
            .then(() => asAlice.delete('/v1/config/analytics')
              .expect(200))
            .then(() => asAlice.get('/v1/audits?action=config.set')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(2);
                body[0].actorId.should.equal(5);
                should.not.exist(body[0].acteeId);
                body[0].details.should.eql({ key: 'analytics', value: null });
              })))));
    });
  });

  describe('/backups', () => {
    describe('GET', () => {
      it('should reject if the user cannot read config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/config/backups').expect(403))));

      it('should return not found if backups are not configured', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/config/backups').expect(404))));

      it('should return backup config details if configured', testService((service, { Configs }) =>
        Configs.set('backups.main', { type: 'google' })
          .then(() => service.login('alice', (asAlice) =>
            asAlice.get('/v1/config/backups')
              .expect(200)
              .then(({ body }) => {
                body.setAt.should.be.an.isoDate();
                // eslint-disable-next-line no-param-reassign
                delete body.setAt;
                body.should.eql({ type: 'google' });
              })))));
    });

    describe('DELETE', () => {
      it('should reject if the user cannot set config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.delete('/v1/config/backups').expect(403))));

      it('should return success even if no config is set', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/config/backups').expect(200))));

      it('should clear the config if it exists', testService((service, { Configs }) =>
        Configs.set('backups.main', { type: 'google' })
          .then(() => service.login('alice', (asAlice) =>
            asAlice.delete('/v1/config/backups')
              .expect(200)
              .then(() => asAlice.get('/v1/config/backups').expect(404))))));

      it('should log the action in the audit log', testService((service, { Configs }) =>
        Configs.set('backups.main', { type: 'google' })
          .then(() => service.login('alice', (asAlice) =>
            asAlice.delete('/v1/config/backups')
              .expect(200)
              .then(() => asAlice.get('/v1/audits?action=config.set')
                .expect(200)
                .then(({ body }) => {
                  body.length.should.equal(1);
                  body[0].actorId.should.equal(5);
                  should.not.exist(body[0].acteeId);
                  body[0].details.should.eql({ key: 'backups.main', value: null });
                }))))));
    });

    describe('/initiate POST', () => {
      it('should reject if the user cannot set config', testService((service) =>
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

      it('should work given no passphrase', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups/initiate')
            .expect(200))));
    });

    describe('/verify POST', () => {
      it('should reject if the user cannot set config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.post('/v1/config/backups/verify').expect(403))));

      it('should reject unless the provisioned auth token is used', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups/verify').expect(403))));

      // does the entire round-trip:
      it('should store all configuration in the database', testService((service, { Configs }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups/initiate')
            .send({ passphrase: 'super secure' })
            .expect(200)
            .then(({ body }) => service.post('/v1/config/backups/verify')
              .set('Authorization', `Bearer ${body.token}`)
              .send({ code: 'happy google' })
              .expect(200)
              .then(() => asAlice.get('/v1/config/backups')
                .expect(200)
                .then(() => Promise.all([ 'backups.main', 'backups.google' ].map(Configs.get))
                  .then(map(getOrNotFound))
                  .then(map((x) => x.value))
                  .then(([ main, google ]) => {
                    main.type.should.equal('google');
                    should.exist(main.keys);
                    google.code.should.equal('happy google');
                  })))))));

      it('should not allow token replay', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups/initiate')
            .send({ passphrase: 'super secure' })
            .expect(200)
            .then(({ body }) => service.post('/v1/config/backups/verify')
              .set('Authorization', `Bearer ${body.token}`)
              .send({ code: 'happy google' })
              .expect(200)
              .then(() => service.post('/v1/config/backups/verify')
                .set('Authorization', `Bearer ${body.token}`)
                .send({ code: 'happy google' })
                .expect(401))))));

      it('should handle google connection failures appropriately', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups/initiate')
            .send({ passphrase: 'super secure' })
            .expect(200)
            .then(({ body }) => service.post('/v1/config/backups/verify')
              .set('Authorization', `Bearer ${body.token}`)
              .send({ code: 'sad google' })
              .expect(400)
              // eslint-disable-next-line no-shadow
              .then(({ body }) => {
                body.code.should.equal(400.9);
                body.details.reason.should.match(/sad google/);
              })))));

      it('should log the action in the audit log', () => testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/backups/initiate')
            .send({ passphrase: 'super secure' })
            .expect(200)
            .then(({ body }) => service.post('/v1/config/backups/verify')
              .set('Authorization', `Bearer ${body.token}`)
              .send({ code: 'happy google' })
              .expect(200))
            .then(() => service.get('/v1/config/audits?action=config.set')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(2);
                for (const audit of body) {
                  audit.actorId.should.equal(5);
                  should.not.exist(audit.acteeId);
                }

                const details = body.map((audit) => audit.details)
                  .sortBy(({ key }) => key);
                details.should.eql([
                  { key: 'backups.google', value: 'New or refreshed Google API credentials' },
                  { key: 'backups.main', value: { type: 'google' } }
                ]);
              })))));
    });
  });
});

