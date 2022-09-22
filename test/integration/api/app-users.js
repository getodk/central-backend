const should = require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: /projects/:id/app-users', () => {
  describe('POST', () => {
    it('should return 403 unless the user is allowed to create', testService((service) =>
      service.post('/v1/projects/1/app-users')
        .send({ displayName: 'test1' })
        .expect(403)));

    it('should return the created key', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.FieldKey();
            body.displayName.should.equal('test1');
          }))));

    it('should allow project managers to create', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200))));

    it('should not allow the created user any form access', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => body.token)
          .then((key) => service.post(`/v1/key/${key}/projects/1/forms/simple/submissions`)
            .set('Content-Type', 'text/xml')
            .send(testData.instances.simple.one)
            .expect(403)))));

    it('should create a long session', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => body.token)
          .then((key) => service.get(`/v1/key/${key}/sessions/restore`)
            .expect(200)
            .then(({ body }) => {
              body.expiresAt.should.equal('9999-12-31T23:59:59.000Z');
            })))));

    it('should log the action in the audit log', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(() => asAlice.get('/v1/audits?action=field_key.create')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
              body[0].acteeId.should.be.a.uuid();
            })))));
  });

  describe('GET', () => {
    it('should return 403 unless the user is allowed to list', testService((service) =>
      service.get('/v1/projects/1/app-users').expect(403)));

    it('should return a list of tokens in order with merged data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 2' }).expect(200))
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 3' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/app-users')
            .expect(200)
            .then(({ body }) => {
              body.map((fk) => fk.displayName).should.eql([ 'test 3', 'test 2', 'test 1' ]);
              body.forEach((fk) => {
                fk.should.be.a.FieldKey();
                fk.projectId.should.equal(1);
              });
            })))));

    it('should only return tokens from the requested project', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 2' }).expect(200)),
        asAlice.post('/v1/projects').send({ name: 'project 2' }).expect(200)
          .then(({ body }) => asAlice.post(`/v1/projects/${body.id}/app-users`).send({ displayName: 'test 3' }).expect(200))
      ])
        .then(() => asAlice.get('/v1/projects/1/app-users')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(2);
            body[0].displayName.should.equal('test 2');
            body[1].displayName.should.equal('test 1');
          })))));

    it('should leave tokens out if the session is ended', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'compromised' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.get('/v1/projects/1/app-users')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              const [ key ] = body;
              key.should.be.a.FieldKey();
              should(key.token).equal(null);
            })))));

    it('should sort revoked field keys to the bottom', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 2' }).expect(200))
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 3' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/app-users')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body.forEach((key) => key.should.be.a.FieldKey());
              body.map((key) => key.displayName).should.eql([ 'test 3', 'test 1', 'test 2' ]);
            })))));

    it('should join through additional data if extended metadata is requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 2' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/app-users')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => body.forEach((obj) => {
              obj.should.be.an.ExtendedFieldKey();
              obj.createdBy.displayName.should.equal('Alice');
              obj.projectId.should.equal(1);
            }))))));

    it('should correctly report last used in extended metadata', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 2' })
            .then(({ body }) => body)
            .then((fk) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
              .expect(200)
              .then(() => service.post(`/v1/key/${fk.token}/projects/1/forms/simple/submissions`)
                .send(testData.instances.simple.one)
                .set('Content-Type', 'application/xml')
                .expect(200)
                .then(() => asAlice.get('/v1/projects/1/app-users')
                  .set('X-Extended-Metadata', 'true')
                  .expect(200)
                  .then(({ body }) => {
                    // eslint-disable-next-line no-shadow
                    body.forEach((fk) => fk.should.be.an.ExtendedFieldKey());
                    body[0].lastUsed.should.be.a.recentIsoDate();
                    should(body[1].lastUsed).equal(null);
                  }))))))));

    it('should sort revoked field keys to the bottom in extended metadata', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 2' }).expect(200))
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 3' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/app-users')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body.forEach((key) => key.should.be.an.ExtendedFieldKey());
              body.map((key) => key.displayName).should.eql([ 'test 3', 'test 1', 'test 2' ]);
            })))));
  });

  describe('/:id DELETE', () => {
    it('should return 403 unless the user can delete', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) =>
            service.delete('/v1/projects/1/app-users/' + body.id).expect(403)))));

    it('should delete the token', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/projects/1/app-users/' + body.id).expect(200))
          .then(() => asAlice.get('/v1/projects/1/app-users')
            .expect(200)
            .then(({ body }) => body.should.eql([]))))));

    it('should allow project managers to delete', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/app-users').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) => asBob.delete('/v1/projects/1/app-users/' + body.id).expect(200)))));

    it('should delete assignments on the token', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) => body.id)
          .then((id) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${id}`)
            .expect(200)
            .then(() => asAlice.delete(`/v1/projects/1/app-users/${id}`).expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/assignments')
              .expect(200)
              .then(({ body }) => body.should.eql([])))))));

    it('should only delete the token if it is part of the project', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'project 2' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'fktest' })
            .expect(200)
            .then(({ body }) => asAlice.delete(`/v1/projects/2/app-users/${body.id}`)
              .expect(404))))));

    it('should log the action in the audit log', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/projects/1/app-users/' + body.id).expect(200))
          .then(() => asAlice.get('/v1/audits?action=field_key')
            .then(({ body }) => {
              body.map((audit) => audit.action).should.eql([ 'field_key.delete', 'field_key.create' ]);
            })))));
  });
});


// Test the actual use of field keys.
describe('api: /key/:key', () => {
  it('should return 403 if an invalid key is provided', testService((service) =>
    service.get('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/users/current')
      .expect(403)));

  it('should reject non-field tokens', testService((service) =>
    service.post('/v1/sessions').send({ email: 'alice@getodk.org', password: 'alice' })
      .then(({ body }) => service.get(`/v1/key/${body.token}/users/current`)
        .expect(403))));

  it('should passthrough to the appropriate route with successful auth', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'fktest' })
        .then(({ body }) => body)
        .then((fk) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
          .expect(200)
          .then(() => service.post(`/v1/key/${fk.token}/projects/1/forms/simple/submissions`)
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))))));
});

