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

  const promises = [];

  ['one', 'two'].forEach(async instanceId => {
    promises.push(asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
      .send(testData.instances.simpleEntity[instanceId])
      .set('Content-Type', 'application/xml')
      .expect(200));

    promises.push(asAlice.patch(`/v1/projects/1/forms/simpleEntity/submissions/${instanceId}`)
      .send({ reviewState: 'approved' })
      .expect(200));
  });

  await Promise.all(promises);

  await exhaust(container);

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
            p.currentVersion.should.not.have.property('data');
          });
        });
    }));

    it('should return metadata of the entities of the dataset - only deleted', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // TODO: use request once it's ready
      await container.db.any(sql`UPDATE entities SET "deletedAt" = clock_timestamp() WHERE uuid = '12345678-1234-4123-8234-123456789abc';`);

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

    it('should return full entity even if form+submission has been deleted and purged', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/forms/simpleEntity')
        .expect(200);

      await container.Forms.purge(true);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.should.have.property('currentVersion').which.is.an.EntityDef();

          // TODO: needs to be revisited after POST/PUT api
          person.currentVersion.should.have.property('source').which.is.eql({
            type: 'api',
            details: null
          });

          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });
        });
    }));
  });

  describe('GET /datasets/:name/entities/:uuid/versions', () => {
    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/nonexistent/entities/123/versions')
        .expect(404);
    }));

    it('should return notfound if the entity does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities/123/versions')
        .expect(404);
    }));

    it('should reject if the user cannot read', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .expect(403);
    }));

    it('should return all versions of the Entity', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // Use PUT API once that's ready
      const chelsea = await container.db.one(sql`SELECT * FROM users WHERE email = 'chelsea@getodk.org';`);
      await container.db.any(sql`UPDATE entity_defs SET current = false;`);
      await container.db.any(sql`
        INSERT INTO entity_defs ("entityId", "createdAt", "current", "submissionDefId", "data", "creatorId", "userAgent", "label")
        SELECT "entityId", clock_timestamp(), TRUE, NULL, "data", ${chelsea.actorId}, 'postman', "label" || ' updated' FROM entity_defs`);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions.forEach(v => {
            v.should.be.an.EntityDef();
            v.should.have.property('source').which.is.an.EntitySource();
            v.should.have.property('data');
          });
        });
    }));

    it('should return all versions of the Entity - Extended', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // Use PUT API once that's ready
      const chelsea = await container.db.one(sql`SELECT * FROM users WHERE email = 'chelsea@getodk.org';`);
      await container.db.any(sql`UPDATE entity_defs SET current = false;`);
      await container.db.any(sql`
        INSERT INTO entity_defs ("entityId", "createdAt", "current", "submissionDefId", "data", "creatorId", "userAgent", "label")
        SELECT "entityId", clock_timestamp(), TRUE, NULL, "data", ${chelsea.actorId}, 'postman', "label" || ' updated' FROM entity_defs`);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: versions }) => {
          versions.forEach(v => {
            v.should.be.an.ExtendedEntityDef();
            v.should.have.property('source').which.is.an.EntitySource();
            v.should.have.property('data');
          });

          versions[0].creator.displayName.should.be.eql('Alice');
          versions[1].creator.displayName.should.be.eql('Chelsea');
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
    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.patch('/v1/projects/1/datasets/nonexistent/entities/123')
        .expect(404);
    }));

    it('should return notfound if the entity does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.patch('/v1/projects/1/datasets/people/entities/123')
        .expect(404);
    }));

    it('should reject if the user cannot read', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');
      await asChelsea.patch('/v1/projects/1/datasets/people/entities/123')
        .expect(403);
    }));

    it('should store the entity update source and creator id', testEntities(async (service) => {
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .send({
          data: { age: '77' }
        })
        .set('User-Agent', 'central/tests')
        .expect(200)
        .then(({ body: person }) => {
          // Response is the right shape
          person.should.be.an.Entity();
          person.should.have.property('currentVersion').which.is.an.EntityDef();
          person.currentVersion.should.have.property('source').which.is.an.EntitySource();

          // Source is correct
          // TODO: needs to be revisited after POST/PUT api
          person.currentVersion.should.have.property('source').which.is.eql({
            type: 'api',
            details: null
          });

          // Creator id is correct
          person.currentVersion.creatorId.should.equal(6); // bob
          person.creatorId.should.equal(5); // alice - original entity creator

          person.currentVersion.userAgent.should.equal('central/tests');

          // Updated date makes sense
          person.updatedAt.should.be.a.recentIsoDate();
        });

      // Re-check source and creator by re-getting entity
      await asBob.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('source').which.is.eql({
            type: 'api',
            details: null
          });
          person.currentVersion.creatorId.should.equal(6); // bob
          person.creatorId.should.equal(5); // alice - original entity creator
          person.currentVersion.userAgent.should.equal('central/tests');
          person.updatedAt.should.be.a.recentIsoDate();
        });
    }));

    describe('updating data', () => {
      it('should partially update an Entity', testEntities(async (service) => {
        const asAlice = await service.login('alice');
        const newData = { age: '77', first_name: 'Alice' };

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .send({
            data: { age: '77' }
          })
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.should.have.property('data').which.is.eql(newData);
          });

        // re-get entity to check data
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.should.have.property('data').which.is.eql(newData);
          });
      }));

      // should let label be updated
      // should let properties added to dataset after initial entity be added/updated
      // should let fields be set to empty strings
      // it should reject if property is not present in dataset.publishedProperties
    });

    it('should log the entity update event in the audit log', testEntities(async (service, container) => {
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .send({
          data: { age: '77' }
        })
        .expect(200);

      const audit = await container.Audits.getLatestByAction('entity.update.version').then(a => a.get());
      audit.actorId.should.equal(6);
      audit.details.uuid.should.eql('12345678-1234-4123-8234-123456789abc');
      audit.details.dataset.should.eql('people');
    }));
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
