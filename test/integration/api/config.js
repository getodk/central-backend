const should = require('should');
const { testService } = require('../setup');

describe('api: /config', () => {
  describe('generic endpoints', () => {
    describe('POST', () => {
      it('should reject if the user cannot set config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.post('/v1/config/analytics')
            .send({ enabled: true })
            .expect(403))));

      it('should reject for an unknown config', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/config/unknown')
            .send({ foo: 'bar' })
            .expect(400))));

      describe('configs that store JSON values', () => {
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
      });

      describe('configs that store blobs', () => {
        it('should set the config', testService(async (service) => {
          const asAlice = await service.login('alice');
          await asAlice.get('/v1/config/logo')
            .expect(404);
          await asAlice.post('/v1/config/logo')
            .set('Content-Type', 'image/jpeg')
            .send('testimage')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Config();
              body.key.should.equal('logo');
              body.blobExists.should.be.true();
            });
          await asAlice.get('/v1/config/logo')
            .expect(200)
            .then(({ body }) => {
              body.toString('utf8').should.equal('testimage');
            });
        }));

        it('should inline select image types', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/config/logo')
            .set('Content-Type', 'image/jpeg')
            .send('testimage')
            .expect(200);
          await asAlice.get('/v1/config/logo')
            .expect(200)
            .then(({ headers }) => {
              headers['content-disposition'].should.startWith('inline');
            });

          await asAlice.post('/v1/config/logo')
            .set('Content-Type', 'image/svg+xml')
            .send('testimage2')
            .expect(200);
          await asAlice.get('/v1/config/logo')
            .expect(200)
            .then(({ headers }) => {
              headers['content-disposition'].should.startWith('attachment');
            });
        }));
      });

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

      it('should log the action in the audit log', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/config/analytics')
          .send({ enabled: true })
          .expect(200);
        await asAlice.post('/v1/config/logo')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(200);
        const { body: audits } = await asAlice.get('/v1/audits?action=config.set')
          .expect(200);
        audits.length.should.equal(2);
        for (const audit of audits) {
          audit.actorId.should.equal(5);
          should.not.exist(audit.acteeId);
        }

        Object.keys(audits[0].details).should.eql(['key', 'blobId']);
        audits[0].details.key.should.equal('logo');
        audits[0].details.blobId.should.be.a.Number();

        audits[1].details.should.eql({
          key: 'analytics',
          value: { enabled: true }
        });
      }));
    });

    describe('GET - private config', () => {
      it('should reject if the user cannot read config', testService((service) =>
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
    });

    describe('GET - public config', () => {
      it('should reject if the config is not public', testService((service) =>
        service.get('/v1/config/public/analytics').expect(403)));

      it('should return notfound if the config is not set', testService(async (service) =>
        service.get('/v1/config/public/login-appearance').expect(404)));

      it('should return the config', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/config/login-appearance')
          .send({ title: 'foo' })
          .expect(200);
        await service.get('/v1/config/public/login-appearance')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Config();
            body.key.should.equal('login-appearance');
            body.value.should.eql({ title: 'foo' });
            body.setAt.should.be.a.recentIsoDate();
          });

        await asAlice.post('/v1/config/logo')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(200);
        await service.get('/v1/config/public/logo')
          .expect(200)
          .then(({ body }) => {
            body.toString('utf8').should.equal('testimage');
          });
      }));
    });

    describe('GET - all public config', () => {
      it('should return all public configs', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/config/analytics')
          .send({ enabled: true })
          .expect(200);
        await asAlice.post('/v1/config/login-appearance')
          .send({ title: 'foo' })
          .expect(200);
        await asAlice.post('/v1/config/logo')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(200);

        const { body: configs } = await service.get('/v1/config/public')
          .expect(200);
        // Excludes private configs (analytics) and unset configs (hero-image).
        Object.keys(configs).should.eql(['login-appearance', 'logo']);

        const loginAppearance = configs['login-appearance'];
        loginAppearance.should.be.a.Config();
        loginAppearance.key.should.equal('login-appearance');
        loginAppearance.value.should.eql({ title: 'foo' });

        const { logo } = configs;
        logo.should.be.a.Config();
        logo.key.should.equal('logo');
        logo.blobExists.should.be.true();
      }));
    });

    describe('DELETE', () => {
      it('should reject if the user cannot set config', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.delete('/v1/config/analytics').expect(403))));

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
});

