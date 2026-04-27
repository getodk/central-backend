const { testService } = require('../setup');
const { createDataset } = require('../../util/entities');

describe('api: /projects/:id/user-properties', () => {
  describe('POST /projects/:id/user-properties', () => {
    it('should return 403 if the user cannot update the project', testService(async (service) => {
      const asChelsea = await service.login('chelsea');
      await asChelsea.post('/v1/projects/1/user-properties')
        .send({ name: 'region' })
        .expect(403);
    }));

    it('should create a user property and return success', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/user-properties')
        .send({ name: 'region' })
        .expect(200);
    }));

    it('should reject if name is missing', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/user-properties')
        .send({})
        .expect(400);
    }));
  });

  describe('GET /projects/:id/user-properties', () => {
    it('should return an empty list if no properties exist', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.get('/v1/projects/1/user-properties')
        .expect(200)
        .then(({ body }) => {
          body.should.eql([]);
        });
    }));

    it('should return the created properties', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'region' }).expect(200);
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'plot_id' }).expect(200);
      await asAlice.get('/v1/projects/1/user-properties')
        .expect(200)
        .then(({ body }) => {
          body.map(p => p.name).should.containDeep(['plot_id', 'region']);
        });
    }));
  });

  describe('PATCH /projects/:id/app-users/:id', () => {
    it('should set user property values on an app user', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'region' }).expect(200);

      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ userProperties: { region: 'north' } })
        .expect(200)
        .then(({ body }) => {
          body.userProperties.region.should.equal('north');
        });
    }));

    it('should unset a user property when passed null', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'region' }).expect(200);

      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ userProperties: { region: 'north' } })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ userProperties: { region: null } })
        .expect(200)
        .then(({ body }) => {
          body.userProperties.should.eql({});
        });
    }));

    it('should return 404 if the user property does not exist', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: appUser } = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test user' })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${appUser.id}`)
        .send({ userProperties: { nonexistent: 'value' } })
        .expect(404);
    }));
  });

  describe('PUT /projects/:id/datasets/:name/access-filter', () => {
    it('should set an access filter rule', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id']);
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'plot_id' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', userProperty: 'plot_id' })
        .expect(200)
        .then(({ body }) => {
          body.datasetProperty.should.equal('plot_id');
          body.userProperty.should.equal('plot_id');
        });
    }));

    it('should replace an existing rule', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id', 'region']);
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'plot_id' }).expect(200);
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'region' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', userProperty: 'plot_id' })
        .expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'region', userProperty: 'region' })
        .expect(200)
        .then(({ body }) => {
          body.datasetProperty.should.equal('region');
          body.userProperty.should.equal('region');
        });
    }));

    it.skip('should clear the rule when sent null body', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id']);
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'plot_id' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', userProperty: 'plot_id' })
        .expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({})
        .expect(200)
        .then(({ body }) => {
          (body === null || body === undefined || Object.keys(body).length === 0).should.be.true();
        });
    }));
  });

  describe('GET /projects/:id/datasets/:name/access-filter', () => {
    it('should return the current access filter', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'trees', ['plot_id']);
      await asAlice.post('/v1/projects/1/user-properties').send({ name: 'plot_id' }).expect(200);

      await asAlice.put('/v1/projects/1/datasets/trees/access-filter')
        .send({ datasetProperty: 'plot_id', userProperty: 'plot_id' })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/trees/access-filter')
        .expect(200)
        .then(({ body }) => {
          body.datasetProperty.should.equal('plot_id');
          body.userProperty.should.equal('plot_id');
        });
    }));
  });
});
