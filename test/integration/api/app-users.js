const should = require('should');
const { testService, withClosedForm } = require('../setup');
const testData = require('../../data/xml');

describe('api: /projects/:id/app-users', () => {
  describe('POST', () => {
    it('should return 403 unless the user is allowed to create', testService((service) =>
      service.login('chelsea', asChelsea =>
        asChelsea.post('/v1/projects/1/app-users')
          .send({ displayName: 'test1' })
          .expect(403))));

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

    it('should set actor property values when creating app user', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);

      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({
          displayName: 'test user',
          properties: { region: 'north' }
        })
        .expect(200);

      await asAlice.get(`/v1/projects/1/app-users/${appUser.id}`)
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.properties.should.eql({ region: 'north' });
        });
    }));
  });

  describe('GET', () => {
    it('should return 403 unless the user is allowed to list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/app-users').expect(403))));

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

    it('should include properties in extended metadata', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);

      const { body: fk1 } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 1' }).expect(200);
      const { body: fk2 } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test 2' }).expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${fk1.id}`)
        .send({ properties: { region: 'north' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/app-users')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.find((fk) => fk.id === fk1.id).properties.should.eql({ region: 'north' });
          should(body.find((fk) => fk.id === fk2.id).properties).be.null();
        });
    }));
  });

  describe('/:id GET', () => {
    it('should return 403 unless the user can delete', testService(async (service) => {
      const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
      const { body: fk } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test1' }).expect(200);
      await asChelsea.get(`/v1/projects/1/app-users/${fk.id}`).expect(403);
    }));

    it('should return the app user', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: created } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test1' }).expect(200);
      const { body } = await asAlice.get(`/v1/projects/1/app-users/${created.id}`).expect(200);
      body.should.be.a.FieldKey();
      body.displayName.should.equal('test1');
    }));

    it('should return 404 if the app user is not in the project', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: project2 } = await asAlice.post('/v1/projects').send({ name: 'project 2' }).expect(200);
      const { body: fk } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test1' }).expect(200);
      await asAlice.get(`/v1/projects/${project2.id}/app-users/${fk.id}`).expect(404);
    }));

    it('should return extended metadata if requested', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: created } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test1' }).expect(200);
      const { body } = await asAlice.get(`/v1/projects/1/app-users/${created.id}`)
        .set('X-Extended-Metadata', 'true')
        .expect(200);
      body.should.be.an.ExtendedFieldKey();
      body.displayName.should.equal('test1');
      body.createdBy.displayName.should.equal('Alice');
    }));

    it('should return null properties when no actor properties are defined on the project', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: created } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'test1' }).expect(200);
      await asAlice.get(`/v1/projects/1/app-users/${created.id}`)
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          should(body.properties).be.null();
        });
    }));
  });

  describe('/:id PATCH', () => {
    it('should set actor property values on an app user', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);

      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'north' } })
        .expect(200)
        .then(({ body }) => {
          body.properties.should.eql({ region: 'north' });
        });
    }));

    it('should set multiple actor properties at once', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'worker_id' }).expect(200);

      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'north', worker_id: '42' } })
        .expect(200)
        .then(({ body }) => {
          body.properties.should.eql({ region: 'north', worker_id: '42' });
        });
    }));

    it('should set some properties and unset others in the same request', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'worker_id' }).expect(200);

      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'north', worker_id: '42' } })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'south', worker_id: null } })
        .expect(200)
        .then(({ body }) => {
          body.properties.should.eql({ region: 'south' });
        });
    }));

    it('should unset an actor property when passed null', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'worker_id' }).expect(200);

      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'north', worker_id: '42' } })
        .expect(200);

      // unset one — the other remains
      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: null } })
        .expect(200)
        .then(({ body }) => {
          body.properties.should.eql({ worker_id: '42' });
        });

      // unset the last one — properties is null
      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { worker_id: null } })
        .expect(200)
        .then(({ body }) => {
          should(body.properties).be.null();
        });
    }));

    it('should return 404 if the actor property does not exist', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { nonexistent: 'value' } })
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.8);
          body.details.field.should.equal('properties');
          body.details.value.should.equal('nonexistent');
        });
    }));

    it('should be a no-op if properties is absent from the body', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'north' } })
        .expect(200);

      // patch without properties key — existing values unchanged
      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({})
        .expect(200)
        .then(({ body }) => {
          body.properties.should.eql({ region: 'north' });
        });
    }));

    it('should treat empty string as null (unsetting the property)', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 'north' } })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: '' } })
        .expect(200)
        .then(({ body }) => {
          should(body.properties).be.null();
        });
    }));

    it('should return 400 if properties is not an object', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: 'not an object' })
        .expect(400)
        .then(({ body }) => { body.code.should.equal(400.8); });

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: ['a', 'b'] })
        .expect(400)
        .then(({ body }) => { body.code.should.equal(400.8); });
    }));

    it('should return 400 if a property value is not a string or null', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ properties: { region: 42 } })
        .expect(400)
        .then(({ body }) => { body.code.should.equal(400.8); });
    }));

    // The property-setting logic (validation, coercion, bulk upsert/delete) is shared
    // under the hood with public links. The tests above cover it fully; public-links
    // tests only verify the happy-path integration without re-testing every edge case.
  });

  describe('/:id DELETE', () => {
    it('should return 403 unless the user can delete', testService((service) =>
      service.login(['alice', 'chelsea'], (asAlice, asChelsea) =>
        asAlice.post('/v1/projects/1/app-users').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) =>
            asChelsea.delete('/v1/projects/1/app-users/' + body.id).expect(403)))));

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
    service.authenticateUser('alice')
      .then((token) => service.get(`/v1/key/${token}/users/current`)
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

  it('should not be able access closed forms and its sub-resources', testService(withClosedForm(async (service) => {
    const asAlice = await service.login('alice');

    const fk = await asAlice.post('/v1/projects/1/app-users')
      .send({ displayName: 'fktest' })
      .then(({ body }) => body);

    await asAlice.post(`/v1/projects/1/forms/withAttachments/assignments/app-user/${fk.id}`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/withAttachments`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/simple2.xls`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/withAttachments.xml`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/withAttachments/versions`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/withAttachments/fields`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/withAttachments/manifest`)
      .set('X-OpenRosa-Version', '1.0')
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/withAttachments/attachments`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/withAttachments/attachments/goodone.csv`)
      .expect(403);
  })));

  it('should be able to assign project viewer role to an app user and access submissions', testService(async (service) => {
    const asAlice = await service.login('alice');

    const fk = await asAlice.post('/v1/projects/1/app-users')
      .send({ displayName: 'hotlinker' })
      .then(({ body }) => body);

    // Assign project viewer role to app user actor id
    await asAlice.post(`/v1/projects/1/assignments/viewer/${fk.id}`)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.binaryType)
      .expect(200);

    await asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
      .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
      .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
      .expect(201);

    // App user can access forms
    await service.get(`/v1/key/${fk.token}/projects/1/forms`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType.xml`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/versions`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/fields`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/manifest`)
      .set('X-OpenRosa-Version', '1.0')
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/attachments`)
      .expect(200);

    // App user can access submissions
    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/submissions`)
      .expect(200);

    // App user can access submission attachments
    await asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
      .expect(200)
      .then(({ headers, body }) => {
        headers['content-type'].should.equal('video/mp4');
        headers['content-disposition'].should.equal('attachment; filename="my_file1.mp4"; filename*=UTF-8\'\'my_file1.mp4');
        body.toString('utf8').should.equal('this is test file one');
      });

    await asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
      .expect(200)
      .then(({ headers, body }) => {
        headers['content-type'].should.equal('image/jpeg');
        headers['content-disposition'].should.equal('inline; filename="here_is_file2.jpg"; filename*=UTF-8\'\'here_is_file2.jpg');
        body.toString('utf8').should.equal('this is test file two');
      });

    // App user should not be able to submit submission because that form writing role hasnt been assigned
    await service.post(`/v1/key/${fk.token}/projects/1/forms/binaryType/submissions`)
      .send(testData.instances.binaryType.one)
      .set('Content-Type', 'text/xml')
      .expect(403);
  }));

  it('should be able to assign project viewer role at the form level to an app user', testService(async (service) => {
    const asAlice = await service.login('alice');

    const fk = await asAlice.post('/v1/projects/1/app-users')
      .send({ displayName: 'form-hotlinker' })
      .then(({ body }) => body);

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.binaryType)
      .expect(200);

    await asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
      .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
      .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
      .expect(201);

    // Assign project viewer role ON A SINGLE FORM to app user actor id
    await asAlice.post(`/v1/projects/1/forms/binaryType/assignments/viewer/${fk.id}`)
      .expect(200);

    // App user CANNOT access project-level things like forms
    await service.get(`/v1/key/${fk.token}/projects/1/forms`)
      .expect(403);

    // App user cannot access other forms they weren't assigned to
    await service.get(`/v1/key/${fk.token}/projects/1/forms/simple`)
      .expect(403);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/simple/submissions`)
      .expect(403);

    // App user can access the one form they are assigned to
    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType.xml`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/versions`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/fields`)
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/manifest`)
      .set('X-OpenRosa-Version', '1.0')
      .expect(200);

    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/attachments`)
      .expect(200);

    // App user can access submissions
    await service.get(`/v1/key/${fk.token}/projects/1/forms/binaryType/submissions`)
      .expect(200);

    // App user can access submission attachments
    await asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
      .expect(200)
      .then(({ headers, body }) => {
        headers['content-type'].should.equal('video/mp4');
        headers['content-disposition'].should.equal('attachment; filename="my_file1.mp4"; filename*=UTF-8\'\'my_file1.mp4');
        body.toString('utf8').should.equal('this is test file one');
      });

    await asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
      .expect(200)
      .then(({ headers, body }) => {
        headers['content-type'].should.equal('image/jpeg');
        headers['content-disposition'].should.equal('inline; filename="here_is_file2.jpg"; filename*=UTF-8\'\'here_is_file2.jpg');
        body.toString('utf8').should.equal('this is test file two');
      });

    // App user should not be able to submit submission because that form writing role hasnt been assigned
    await service.post(`/v1/key/${fk.token}/projects/1/forms/binaryType/submissions`)
      .send(testData.instances.binaryType.one)
      .set('Content-Type', 'text/xml')
      .expect(403);
  }));
});

