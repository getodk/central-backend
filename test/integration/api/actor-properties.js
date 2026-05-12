const { testService } = require('../setup');

describe('api: /projects/:id/actor-properties', () => {
  describe('POST /projects/:id/actor-properties', () => {
    it('should return 403 if the user cannot update the project', testService(async (service) => {
      const asChelsea = await service.login('chelsea');
      await asChelsea.post('/v1/projects/1/actor-properties')
        .send({ name: 'region' })
        .expect(403);
    }));

    it('should create a actor property and return success', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties')
        .send({ name: 'region' })
        .expect(200);
    }));

    it('should reject if name is missing', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties')
        .send({})
        .expect(400);
    }));

    it('should reject if name is not allowed', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties')
        .send({ name: 'name' })
        .expect(400);
      await asAlice.post('/v1/projects/1/actor-properties')
        .send({ name: '__specialSystemName' })
        .expect(400);
      await asAlice.post('/v1/projects/1/actor-properties')
        .send({ name: 'displayName' })
        .expect(400);
    }));

    it('should reject if existing name is sent again', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties')
        .send({ name: 'region' })
        .expect(200);

      await asAlice.post('/v1/projects/1/actor-properties')
        .send({ name: 'region' })
        .expect(409);
    }));
  });

  describe('GET /projects/:id/actor-properties', () => {
    it('should return an empty list if no properties exist', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.get('/v1/projects/1/actor-properties')
        .expect(200)
        .then(({ body }) => {
          body.should.eql([]);
        });
    }));

    it('should return the created properties', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'plot_id' }).expect(200);
      await asAlice.get('/v1/projects/1/actor-properties')
        .expect(200)
        .then(({ body }) => {
          body.map(p => p.name).should.eql(['plot_id', 'region']);
        });
    }));

    it('should return the properties with enumerated values if extended metadata requested', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'plot_id' }).expect(200);

      const { body: fk1 } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'user 1' }).expect(200);
      const { body: fk2 } = await asAlice.post('/v1/projects/1/app-users').send({ displayName: 'user 2' }).expect(200);

      await asAlice.patch(`/v1/projects/1/app-users/${fk1.id}`)
        .send({ properties: { region: 'north', plot_id: 'A1' } })
        .expect(200);
      await asAlice.patch(`/v1/projects/1/app-users/${fk2.id}`)
        .send({ properties: { region: 'south' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/actor-properties')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.should.eql([
            { name: 'plot_id', values: ['A1'] },
            { name: 'region', values: ['north', 'south'] }
          ]);
        });
    }));

    it('should return empty values arrays when no values are set', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/actor-properties').send({ name: 'region' }).expect(200);

      await asAlice.get('/v1/projects/1/actor-properties')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.should.eql([{ name: 'region', values: [] }]);
        });
    }));
  });

});
