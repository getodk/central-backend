const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { sql } = require('slonik');

/* eslint-disable import/no-dynamic-require */
const { exhaust } = require(appRoot + '/lib/worker/worker');
/* eslint-enable import/no-dynamic-require */

const testEntities = (test) => testService(async (service, container) => {
  const asAlice = await service.login('alice');

  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.simpleEntity)
    .expect(200);

  ['one', 'two'].forEach(async instanceId => {
    await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
      .send(testData.instances.simpleEntity[instanceId])
      .set('Content-Type', 'application/xml')
      .expect(200);

    await asAlice.patch(`/v1/projects/1/forms/simpleEntity/submissions/${instanceId}`)
      .send({ reviewState: 'approved' })
      .expect(200);
  });

  await exhaust(container);

  // Temporary code, we will remove it once we real migration ready
  await container.db.any(sql`UPDATE entity_defs SET label='TEMP', "userAgent"='NODEJS', "creatorId" = 5;`);

  await test(service, container);
});

describe('Entities API', () => {
  describe('GET /datasets/:name/entities', () => {

    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/nonexistent/entities')
        .expect(404);
    }));

    it('should reject if the user cannot read', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.get('/v1/projects/1/datasets/people/entities')
        .expect(403);
    }));

    it('should happily return given no entities', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body }) => {
          body.should.eql([]);
        });
    }));

    it('should return metadata of the entities of the dataset', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body: people }) => {
          people.forEach(p => {
            p.should.be.an.Entity();
            p.should.have.property('currentVersion').which.is.an.EntityDef();
          });
        });
    }));

    it('should return metadata of the entities of the dataset - only deleted', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // TODO: use request once it's ready
      await container.db.any(sql`UPDATE entities SET "deletedAt" = clock_timestamp() WHERE id = 1;`);

      await asAlice.get('/v1/projects/1/datasets/people/entities?deleted=true')
        .expect(200)
        .then(({ body: people }) => {
          people.forEach(p => {
            p.should.be.an.Entity();
            p.should.have.property('currentVersion').which.is.an.EntityDef();
            p.deletedAt.should.be.an.isoDate();
          });

        });
    }));

    it('should return extended metadata of the entities of the dataset', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: people }) => {
          people.forEach(p => {
            p.should.be.an.ExtendedEntity();
            p.should.have.property('currentVersion').which.is.an.ExtendedEntityDef();
          });
        });
    }));
  });

  describe('GET /datasets/:name/entities/:uuid', () => {

    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/nonexistent/entities/123')
        .expect(404);
    }));

    it('should return notfound if the entity does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities/123')
        .expect(404);
    }));

    it('should reject if the user cannot read', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(403);
    }));

    it('should return full entity', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.should.have.property('currentVersion').which.is.an.EntityDef();

          person.currentVersion.should.have.property('source').which.is.an.EntitySource();

          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });
        });
    }));

    it('should return full extended entity', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.ExtendedEntity();
          person.should.have.property('currentVersion').which.is.an.ExtendedEntityDef();

          person.currentVersion.should.have.property('source').which.is.an.EntitySource();

          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });
        });
    }));
  });

  describe('GET /datasets/:name/entities/:uuid/versions', () => {
    it('should return all versions of the Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities/00000000-0000-0000-0000-000000000001/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions.forEach(v => {
            v.should.be.an.EntityDef();
            v.should.have.property('source').which.is.an.EntitySource();
            v.should.have.property('data');
          });
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
    it('should return audit logs of the Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/People/entities/00000000-0000-0000-0000-000000000001/audits')
        .expect(200)
        .then(({ body }) => {
          body[0].action.should.be.eql('entity.update.version');
          body[0].details.should.be.eql({
            entityId: '00000000-0000-0000-0000-000000000001',
            source: {
              type: 'api',
              details: null
            },
            label: 'Jane Roe',
            versionNumber: 2
          });
          body[1].action.should.be.eql('entity.create');
          // assert nested logs here
        });
    }));
  });

  describe('POST /datasets/:name/entities', () => {

    it('should create an Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/People/entities')
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
          person.should.have.property('currentVersion').which.is.an.EntityDef();
          person.currentVersion.should.have.property('source').which.is.an.EntitySource();
          person.currentVersion.should.have.property('data').which.is.eql({
            firstName: 'Johnny',
            lastName: 'Doe',
            city: 'Toronto'
          });
        });
    }));

    // it should reject if uuid or label is missing
    // it should reject if property is not present in dataset.publishedProperties
    // it should reject if user don't have permission
    // it should reject if uuid is not unique ??? what to do if uuid is deleted?

  });

  describe('PUT /datasets/:name/entities/:uuid', () => {

    it('should update an Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.put('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001')
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
          person.should.have.property('currentVersion').which.is.an.EntityDef();
          person.currentVersion.should.have.property('source').which.is.an.EntitySource();
          person.currentVersion.should.have.property('data').which.is.eql({
            firstName: 'Richard',
            lastName: 'Roe',
            city: 'Toronto'
          });
        });
    }));

    // it should reject if uuid is not found
    // it should reject if uuid in queryParam and body don't match
    // it should reject if uuid or label is missing
    // it should reject if property is not present in dataset.publishedProperties
    // it should reject if user don't have permission
  });

  describe('PATCH /datasets/:name/entities/:uuid', () => {

    it('should partially update an Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.patch('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001')
        .send({
          city: 'Boston'
        })
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.should.have.property('currentVersion').which.is.an.EntityDef();
          person.currentVersion.should.have.property('source').which.is.an.EntitySource();
          person.currentVersion.should.have.property('data').which.is.eql({
            firstName: 'Johnny',
            lastName: 'Doe',
            city: 'Boston'
          });
        });
    }));

    // it should reject if uuid is not found
    // it should reject if uuid is provided in the body and it is different then the queryParam
    // it should reject if property is not present in dataset.publishedProperties
    // it should reject if user don't have permission

  });

  describe('DELETE /datasets/:name/entities/:uuid', () => {

    it('should delete an Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001')
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });
    }));

    // it should reject if uuid is not found
    // it should reject if body is not empty
    // it should reject if user don't have permission

  });

  // Lowest Priority
  describe.skip('POST /datasets/:name/entities/:uuid/restore', () => {

    it('should restore a deleted Entity', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/People/entities/10000000-0000-0000-0000-000000000001/restore')
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.should.have.property('currentVersion').which.is.an.EntityDef();
          person.currentVersion.should.have.property('source').which.is.an.EntitySource();
          person.currentVersion.should.have.property('data').which.is.eql({
            firstName: 'Jane',
            lastName: 'Roe',
            city: 'Toronto'
          });
        });
    }));

    // it should reject if uuid is not found or is not deleted
    // it should reject if body is not empty
    // it should reject if user don't have permission

  });
});
