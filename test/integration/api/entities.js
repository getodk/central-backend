const { testService } = require('../setup');

describe('Entities API', () => {
  describe('GET /datasets/:name/entities', () => {
    it('should return metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities')
        .expect(200)
        .then(({ body: people }) => {
          people.map(p => p.should.be.an.EntitySummary());
        });
    }));

    it('should return metadata of the entities of the dataset - only deleted', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities?deleted=true')
        .expect(200)
        .then(({ body: people }) => {
          people.map(p => p.should.be.an.EntitySummary());
          people[0].deletedAt.should.be.an.isoDate();
          people[0].currentVersion.deleted.should.be.true();

        });
    }));

    it('should return extended metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: people }) => {
          people.map(p => p.should.be.an.ExtendedEntitySummary());
        });
    }));
  });

  describe('GET /datasets/:name/entities/:uuid', () => {
    it('should return full entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities/00000000-0000-0000-0000-000000000001')
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.currentVersion.data.should.eql({
            firstName: 'Jane',
            lastName: 'Roe',
            city: 'Toronto'
          });
        });
    }));

    // it should return extended entity
  });

  describe('GET /datasets/:name/entities/:uuid/versions', () => {
    it('should return full entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities/00000000-0000-0000-0000-000000000001/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions.map(v => v.should.be.an.EntityDef());
        });
    }));

  });

  describe('GET /datasets/:name/entities/:uuid/diffs', () => {
    it('should return differences between the version of an Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities/00000000-0000-0000-0000-000000000001/diffs')
        .expect(200)
        .then(({ body }) => {
          body[2][0].should.be.eql({ old: 'John', new: 'Jane', propertyName: 'firstName' });
          body[2][1].should.be.eql({ old: 'Doe', new: 'Roe', propertyName: 'lastName' });
          body[2][2].should.be.eql({ old: 'John Doe', new: 'Jane Roe', propertyName: 'label' });
        });
    }));
  });

  describe('GET /datasets/:name/entities/:uuid/audits', () => {
    it('should return metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities/00000000-0000-0000-0000-000000000001/audits')
        .expect(200)
        .then(({ body }) => {
          body[0].action.should.be.eql('entity.update.version');
          body[0].details.should.be.eql({ entityId: '00000000-0000-0000-0000-000000000001', entitySource: 'API', entitySourceId: 'super-client', label: 'Jane Roe', versionNumber: 2 });
          body[1].action.should.be.eql('entity.create');
        });
    }));
  });

  describe('POST /datasets/:name/entities', () => {

    it('should return metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/People/entities')
        .set('X-Client-Id', 'super-client')
        .send({
          uuid: '10000000-0000-0000-0000-000000000001',
          label: 'Johnny Doe',
          firstName: 'Johnny',
          lastName: 'Doe',
          city: 'Toronto'
        })
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
        });
    }));

    // it should reject if uuid or label is missing
    // it should reject if property is not present in dataset.publishedProperties
    // it should reject if user don't have permission
    // it should reject if uuid is not unique ??? what to do if uuid is deleted?

  });

  describe('PUT /datasets/:name/entities/:uuid', () => {

    it('should return metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.put('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001')
        .set('X-Client-Id', 'super-client')
        .send({
          uuid: '10000000-0000-0000-0000-000000000001',
          label: 'Richard Roe',
          firstName: 'Richard',
          lastName: 'Roe',
          city: 'Toronto'
        })
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
        });
    }));

    // it should reject if uuid is not found
    // it should reject if uuid in queryParam and body don't match
    // it should reject if uuid or label is missing
    // it should reject if property is not present in dataset.publishedProperties
    // it should reject if user don't have permission
  });

  describe('PATCH /datasets/:name/entities/:uuid', () => {

    it('should return metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.patch('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001')
        .set('X-Client-Id', 'super-client')
        .send({
          city: 'Boston'
        })
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.currentVersion.data.city.should.be.eql('Boston');
        });
    }));

    // it should reject if uuid is not found
    // it should reject if uuid is provided in the body and it is different then the queryParam
    // it should reject if property is not present in dataset.publishedProperties
    // it should reject if user don't have permission

  });

  describe('DELETE /datasets/:name/entities/:uuid', () => {

    it('should return metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001')
        .set('X-Client-Id', 'super-client')
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });
    }));

    // it should reject if uuid is not found
    // it should reject if body is not empty
    // it should reject if user don't have permission

  });

  describe('POST /datasets/:name/entities/:uuid/restore', () => {

    it('should return metadata of the entities of the dataset', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001/restore')
        .set('X-Client-Id', 'super-client')
        .expect(200)
        .then(({ body }) => {
          body.should.be.an.EntitySummary();
        });
    }));

    // it should reject if uuid is not found or is not deleted
    // it should reject if body is not empty
    // it should reject if user don't have permission

  });
});
