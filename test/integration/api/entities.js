const appRoot = require('app-root-path');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const { sql } = require('slonik');
const should = require('should');
const { QueryOptions, queryFuncs } = require('../../../lib/util/db');
const { getById, createVersion } = require('../../../lib/model/query/entities');
const { log } = require('../../../lib/model/query/audits');
const Option = require('../../../lib/util/option');
const { Entity } = require('../../../lib/model/frames');

const { exhaust } = require(appRoot + '/lib/worker/worker');

const testDataset = (test) => testService(async (service, container) => {
  const asAlice = await service.login('alice');

  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.simpleEntity)
    .expect(200);

  await test(service, container);
});

const testEntities = (test) => testService(async (service, container) => {
  const asAlice = await service.login('alice');

  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.simpleEntity)
    .expect(200);

  await asAlice.patch('/v1/projects/1/datasets/people')
    .send({ approvalRequired: true })
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

const testEntityUpdates = (test) => testService(async (service, container) => {
  const asAlice = await service.login('alice');

  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.simpleEntity)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await asAlice.post('/v1/projects/1/datasets/people/entities')
    .send({
      uuid: '12345678-1234-4123-8234-123456789abc',
      label: 'Johnny Doe',
      data: { first_name: 'Johnny', age: '22' }
    })
    .expect(200);

  // create a form that can update or create an entity
  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.updateEntity
      .replace('update=""', 'update="" create=""'))
    .set('Content-Type', 'application/xml')
    .expect(200);

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
            p.currentVersion.should.not.have.property('dataReceived');
          });
        });
    }));

    it('should return metadata of the entities of the dataset - only deleted', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

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

    it('should not mince the object properties', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ label: 'two' })
        .expect(200);

      await container.run(sql`UPDATE actors SET "createdAt" = '2020-01-01T00:00:00Z' WHERE "displayName" = 'Alice'`);
      await container.run(sql`UPDATE actors SET "createdAt" = '2021-01-01T00:00:00Z' WHERE "displayName" = 'Bob'`);

      await container.run(sql`UPDATE entities SET "createdAt" = '2022-01-01T00:00:00Z', "updatedAt" = '2023-01-01T00:00:00Z' WHERE uuid = '12345678-1234-4123-8234-123456789abc'`);

      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2022-01-01T00:00:00Z' WHERE label = 'Alice (88)'`);
      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2023-01-01T00:00:00Z' WHERE label = 'two'`);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: people }) => {
          people.forEach(p => {
            p.should.be.an.ExtendedEntity();
            p.should.have.property('currentVersion').which.is.an.ExtendedEntityDef();
          });

          const person = people.find(p => p.uuid === '12345678-1234-4123-8234-123456789abc');

          person.createdAt.should.match(/2022/);
          person.updatedAt.should.match(/2023/);

          person.creator.displayName.should.be.eql('Alice');
          person.creator.createdAt.should.match(/2020/);

          person.currentVersion.createdAt.should.match(/2023/);
          person.currentVersion.creator.displayName.should.be.eql('Bob');
          person.currentVersion.creator.createdAt.should.match(/2021/);
        });
    }));

    it('should return entities in stable order', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111aaa',
          label: 'Foo',
          data: {
            first_name: 'Foo',
          }
        })
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111bbb',
          label: 'Bar',
          data: {
            first_name: 'Bar',
          }
        })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: people }) => {
          people.map(p => p.currentVersion.label).should.eql(['Bar', 'Foo']);
        });

      // Update Foo
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa?baseVersion=1')
        .send({ data: { age: '12' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: people }) => {
          people.map(p => p.currentVersion.label).should.eql(['Bar', 'Foo']);
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
          person.currentVersion.should.have.property('version').which.is.equal(1);
          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });
          person.currentVersion.should.have.property('dataReceived').which.is.eql({
            age: '88',
            first_name: 'Alice',
            label: 'Alice (88)'
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
          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });
        });
    }));

    it('should return current version of entity data when updated', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      // testEntityUpdates does the following: creates dataset, creates update form. test needs to submit update.
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.ExtendedEntity();
          person.should.have.property('currentVersion').which.is.an.ExtendedEntityDef();
          person.currentVersion.should.have.property('version').which.is.equal(2);
          person.currentVersion.should.have.property('label').which.is.equal('Alicia (85)');
          person.currentVersion.should.have.property('data').which.is.eql({
            age: '85',
            first_name: 'Alicia'
          });
          person.currentVersion.should.have.property('dataReceived').which.is.eql({
            age: '85',
            first_name: 'Alicia',
            label: 'Alicia (85)'
          });
        });
    }));

    it('should not mince the object properties', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ label: 'two' })
        .expect(200);

      await container.run(sql`UPDATE actors SET "createdAt" = '2020-01-01T00:00:00Z' WHERE "displayName" = 'Alice'`);
      await container.run(sql`UPDATE actors SET "createdAt" = '2021-01-01T00:00:00Z' WHERE "displayName" = 'Bob'`);

      await container.run(sql`UPDATE entities SET "createdAt" = '2022-01-01T00:00:00Z', "updatedAt" = '2023-01-01T00:00:00Z'`);

      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2022-01-01T00:00:00Z' WHERE label = 'Alice (88)'`);
      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2023-01-01T00:00:00Z' WHERE label = 'two'`);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.ExtendedEntity();
          person.should.have.property('currentVersion').which.is.an.ExtendedEntityDef();
          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });

          person.createdAt.should.match(/2022/);
          person.updatedAt.should.match(/2023/);

          person.creator.displayName.should.be.eql('Alice');
          person.creator.createdAt.should.match(/2020/);

          person.currentVersion.createdAt.should.match(/2023/);
          person.currentVersion.creator.displayName.should.be.eql('Bob');
          person.currentVersion.creator.createdAt.should.match(/2021/);
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

          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });
        });
    }));

    it('should return an Entity with SOFT conflict', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '99' } })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // changes label only
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: person }) => {
          person.conflict.should.be.eql('soft');

          const { currentVersion } = person;
          currentVersion.data.should.eql({ age: '99', first_name: 'Alice' });
          currentVersion.label.should.eql('Alicia - 85');
          currentVersion.dataReceived.should.eql({ label: 'Alicia - 85' });
          currentVersion.version.should.equal(3);
          currentVersion.conflictingProperties.should.be.eql([]);
        });
    }));

    it('should return an Entity with HARD conflict', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '99' } })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // all properties changed
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: person }) => {
          person.conflict.should.be.eql('hard');

          const { currentVersion } = person;
          currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
          currentVersion.label.should.eql('Alicia (85)');
          currentVersion.version.should.equal(3);
          currentVersion.conflictingProperties.should.be.eql(['age']);
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

    it('should return all versions of the Entity', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '12', first_name: 'John' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions.forEach(v => {
            v.should.be.an.EntityDefFull();
          });

          versions[1].data.should.be.eql({ age: '12', first_name: 'John' });
          versions[1].lastGoodVersion.should.be.true();
        });
    }));

    it('should return all versions of the Entity - Extended', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '12', first_name: 'John' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body: versions }) => {
          versions.forEach(v => {
            v.should.be.an.ExtendedEntityDef();
            v.should.be.an.EntityDefFull();
          });

          versions[0].creator.displayName.should.be.eql('Alice');
          versions[1].creator.displayName.should.be.eql('Bob');

          versions[1].data.should.be.eql({ age: '12', first_name: 'John' });
        });
    }));

    it('should return all versions of the Entity - Conflicts', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
        .send({ data: { age: '12' } })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Soft conflict - only label is changed
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.conflict.should.be.eql('soft');
        });

      // Hard conflict - all properties are changed
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.conflict.should.be.eql('hard');
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions.forEach(v => {
            v.should.be.an.EntityDefFull();
          });

          versions.filter(v => v.relevantToConflict).map(v => v.version).should.eql([1, 2, 3, 4]);

          const thirdVersion = versions[2];
          thirdVersion.conflict.should.be.eql('soft');
          thirdVersion.conflictingProperties.should.be.eql([]);
          thirdVersion.source.event.action.should.be.eql('submission.create');
          thirdVersion.source.submission.instanceId.should.be.eql('two');

          const fourthVersion = versions[3];
          fourthVersion.conflict.should.be.eql('hard');
          fourthVersion.conflictingProperties.should.be.eql(['age', 'label']);
          fourthVersion.source.event.action.should.be.eql('submission.create');
          fourthVersion.source.submission.instanceId.should.be.eql('one');

        });
    }));

    it('should get version source with source details even when there is no corresponding submission event', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: {
            name: 'people.csv',
            size: 100,
          },
          entities: [
            {
              uuid: '12345678-1234-4123-8234-111111111aaa',
              label: 'Johnny Doe',
              data: {
                first_name: 'Johnny',
                age: '22'
              }
            },
          ]
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions[0].should.have.property('source');
          versions[0].source.should.eql({ name: 'people.csv', size: 100, count: 1, userAgent: null });
        });
    }));

    describe('relevantToConflict', () => {

      const createConflictOnV2 = async (user, container) => {
        await user.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
          .send({ data: { age: '12' } })
          .expect(200);

        await user.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=2')
          .send({ data: { age: '18' } })
          .expect(200);

        await user.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Hard conflict - all properties are changed
        await user.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one.replace('baseVersion="1"', 'baseVersion="2"'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);
      };

      it('should return only relevent versions needed for conflict resolution', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        await createConflictOnV2(asAlice, container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions?relevantToConflict=true')
          .expect(200)
          .then(({ body: versions }) => {
            // Doesn't return first version
            versions.map(v => v.version).should.eql([2, 3, 4]);

            versions[1].lastGoodVersion.should.be.true();
            versions[2].conflictingProperties.should.be.eql(['age']);
          });
      }));

      it('should correctly set relevantToConflict field', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        await createConflictOnV2(asAlice, container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
          .expect(200)
          .then(({ body: versions }) => {
            versions.filter(v => v.relevantToConflict).map(v => v.version).should.eql([2, 3, 4]);
          });

      }));

      it('should return empty array when all conflicts are resolved', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        await createConflictOnV2(asAlice, container);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=4')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions?relevantToConflict=true')
          .expect(200)
          .then(({ body: versions }) => {
            versions.length.should.be.eql(0);
          });
      }));

      it('should return only relevent versions after conflict resolution', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        await createConflictOnV2(asAlice, container);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=4')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.two
            .replace('baseVersion="1"', 'baseVersion="3"'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions?relevantToConflict=true')
          .expect(200)
          .then(({ body: versions }) => {
            // Doesn't return old versions
            versions.map(v => v.version).should.eql([3, 4, 5]);

            versions[1].lastGoodVersion.should.be.true();
            versions[2].conflictingProperties.should.be.eql(['label']);
          });
      }));

      it('should correctly set `resolved` flag for the versions', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        await createConflictOnV2(asAlice, container);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=4')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.two
            .replace('baseVersion="1"', 'baseVersion="2"'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
          .expect(200)
          .then(({ body: versions }) => {
            // resolved flag is true only for the old conflict
            versions.map(v => v.resolved).should.eql([false, false, false, true, false]);
          });
      }));

      it('should return correct response for conflict after second resolution', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');
        await createConflictOnV2(asAlice, container);
        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=4')
          .expect(200);

        // Create v5 based on v3, then resolve it.
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.two
            .replace('baseVersion="1"', 'baseVersion="3"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);
        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=5')
          .expect(200);

        // Create v6 based on v3, but don't resolve it.
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.three
            .replace('baseVersion="1"', 'baseVersion="3"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);

        const { body: versions } = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
          .expect(200);
        versions.length.should.equal(6);
        versions[5].conflict.should.equal('hard');
        versions.map(version => version.resolved)
          .should.eql([false, false, false, true, true, false]);
        versions.filter(version => version.lastGoodVersion)
          .map(version => version.version)
          .should.eql([5]);
        versions.filter(version => version.relevantToConflict)
          .map(version => version.version)
          .should.eql([3, 5, 6]);
      }));
    });
  });

  describe('GET /datasets/:name/entities/:uuid/diffs', () => {
    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/nonexistent/entities/123/diffs')
        .expect(404);
    }));

    it('should return notfound if the entity does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities/123/diffs')
        .expect(404);
    }));

    it('should reject if the user cannot read', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/diffs')
        .expect(403);
    }));

    it('should return differences between the version of an Entity', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '12', first_name: 'John' }, label: 'John (12)' })
        .expect(200);

      // creating a new property in the dataset
      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
        .send(testData.forms.simpleEntity
          .replace('first_name', 'city'))
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=2.0'));

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '12', first_name: 'John', city: 'Toronto' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/diffs')
        .expect(200)
        .then(({ body }) => {
          body.should.be.eql([
            [
              { old: 'Alice (88)', new: 'John (12)', propertyName: 'label' },
              { old: '88', new: '12', propertyName: 'age' },
              { old: 'Alice', new: 'John', propertyName: 'first_name' }
            ],
            [
              { new: 'Toronto', propertyName: 'city' }
            ]
          ]);
        });
    }));
  });

  describe('GET /datasets/:name/entities/:uuid/audits', () => {

    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/nonexistent/entities/123/audits')
        .expect(404);
    }));

    it('should return notfound if the entity does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities/123/audits')
        .expect(404);
    }));

    it('should reject if the user cannot read', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(403);
    }));

    it('should return audit logs of the Entity including updates via API and submission', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '12', first_name: 'John' } })
        .expect(200);

      // update a second time via submission
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asBob.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.update.version');
          logs[0].details.entity.uuid.should.be.eql('12345678-1234-4123-8234-123456789abc');
          logs[0].actor.displayName.should.be.eql('Bob');

          logs[0].details.source.submission.should.be.a.Submission();
          logs[0].details.source.submission.xmlFormId.should.be.eql('updateEntity');
          logs[0].details.source.submission.currentVersion.instanceName.should.be.eql('one');
          logs[0].details.source.submission.currentVersion.submitter.displayName.should.be.eql('Bob');
          logs[0].details.source.event.should.be.an.Audit();
          logs[0].details.source.event.actor.displayName.should.be.eql('Bob');
          logs[0].details.source.event.loggedAt.should.be.isoDate();
          logs[0].details.source.event.action.should.be.eql('submission.create');

          logs[1].should.be.an.Audit();
          logs[1].action.should.be.eql('entity.update.version');
          logs[1].details.entity.uuid.should.be.eql('12345678-1234-4123-8234-123456789abc');
          logs[1].actor.displayName.should.be.eql('Bob');
          logs[1].details.source.should.be.eql({});

          logs[2].should.be.an.Audit();
          logs[2].action.should.be.eql('entity.create');
          logs[2].actor.displayName.should.be.eql('Alice');

          logs[2].details.source.event.should.be.an.Audit();
          logs[2].details.source.event.actor.displayName.should.be.eql('Alice');
          logs[2].details.source.event.loggedAt.should.be.isoDate();
          logs[2].details.source.event.action.should.be.eql('submission.update');

          logs[2].details.source.submission.should.be.a.Submission();
          logs[2].details.source.submission.xmlFormId.should.be.eql('simpleEntity');
          logs[2].details.source.submission.currentVersion.instanceName.should.be.eql('one');
          logs[2].details.source.submission.currentVersion.submitter.displayName.should.be.eql('Alice');
        });
    }));

    it('should return audit logs of the Entity when it is created via POST API', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111aaa',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(200)
        .then(({ body }) => {
          body.should.be.an.Entity();
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa/audits')
        .expect(200)
        .then(({ body: logs }) => {

          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.create');
          logs[0].actor.displayName.should.be.eql('Alice');

        });
    }));

    it('should return the latest instance name of a source submission', testEntities(async (service) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asBob.put('/v1/projects/1/forms/simpleEntity/submissions/one')
        .set('Content-Type', 'text/xml')
        .send(testData.instances.simpleEntity.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')
          .replace('<orx:instanceName>one</orx:instanceName>', '<orx:instanceName>new instance name</orx:instanceName>'))
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.create');
          logs[0].actor.displayName.should.be.eql('Alice');

          logs[0].details.source.submission.should.be.a.Submission();
          logs[0].details.source.submission.xmlFormId.should.be.eql('simpleEntity');
          logs[0].details.source.submission.currentVersion.instanceName.should.be.eql('new instance name');
        });
    }));

    describe('entity source within an audit event', () => {
      it('should not include submission or source event when entity created or updated via API', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].details.source.should.eql({});
          });

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({ label: 'two' })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].details.source.should.eql({});
          });
      }));

      it('should return source when entity created via submission approval', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        // testEntities creates an entity on submission approval
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].details.source.submission.should.be.a.Submission();
            logs[0].details.source.submission.instanceId.should.be.eql('one');
            logs[0].details.source.submission.xmlFormId.should.be.eql('simpleEntity');
            logs[0].details.source.submission.currentVersion.instanceName.should.be.eql('one');

            logs[0].details.source.event.should.be.an.Audit();
            logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
            logs[0].details.source.event.action.should.be.eql('submission.update');
          });
      }));

      it('should return source when entity created via submission creation', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].details.source.submission.should.be.a.Submission();
            logs[0].details.source.submission.instanceId.should.be.eql('one');
            logs[0].details.source.submission.xmlFormId.should.be.eql('simpleEntity');
            logs[0].details.source.submission.currentVersion.instanceName.should.be.eql('one');

            logs[0].details.source.event.should.be.an.Audit();
            logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
            logs[0].details.source.event.action.should.be.eql('submission.create');
          });
      }));

      it('should return source when entity updated via submission', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        // testEntityUpdates does the following: creates dataset, creates update form. test needs to submit update.
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].details.source.submission.should.be.a.Submission();
            logs[0].details.source.submission.instanceId.should.be.eql('one');
            logs[0].details.source.submission.xmlFormId.should.be.eql('updateEntity');
            logs[0].details.source.submission.currentVersion.instanceName.should.be.eql('one');

            logs[0].details.source.event.should.be.an.Audit();
            logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
            logs[0].details.source.event.action.should.be.eql('submission.create');
          });
      }));

      it('should return instanceId even when submission is deleted', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await container.Forms.purge(true);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.create');
            logs[0].actor.displayName.should.be.eql('Alice');

            logs[0].details.source.event.should.be.an.Audit();
            logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
            logs[0].details.source.event.loggedAt.should.be.isoDate();

            logs[0].details.source.submission.instanceId.should.be.eql('one');
            logs[0].details.source.submission.submitter.displayName.should.be.eql('Alice');
            logs[0].details.source.submission.createdAt.should.be.isoDate();

            // submission is only a stub so it shouldn't have currentVersion
            logs[0].details.source.submission.should.not.have.property('currentVersion');
          });
      }));

      it('should return instanceId even when form is deleted', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.create');
            logs[0].actor.displayName.should.be.eql('Alice');

            logs[0].details.source.event.should.be.an.Audit();
            logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
            logs[0].details.source.event.loggedAt.should.be.isoDate();

            logs[0].details.source.submission.instanceId.should.be.eql('one');
            logs[0].details.source.submission.submitter.displayName.should.be.eql('Alice');
            logs[0].details.source.submission.createdAt.should.be.isoDate();

            // submission is only a stub so it doesn't have things like instanceName or currentVersion
            logs[0].details.source.submission.should.not.have.property('instanceName');
            logs[0].details.source.submission.should.not.have.property('currentVersion');
          });
      }));

      // It's not possible to purge audit logs via API.
      // However System Administrators can purge/archive audit logs via SQL
      // to save disk space and improve performance
      it('should return entity audits even when submission and its logs are deleted', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await container.Forms.purge(true);

        await container.run(sql`DELETE FROM audits WHERE action like 'submission%'`);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {

            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.create');
            logs[0].actor.displayName.should.be.eql('Alice');

            logs[0].details.should.not.have.property('approval');
            logs[0].details.should.not.have.property('submission');
            logs[0].details.should.not.have.property('submissionCreate');
          });
      }));
    });

    it('should return right approval details when we have multiple approvals', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one
          .replace('create="1"', 'create="0"'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send(testData.instances.simpleEntity.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .set('X-Action-Notes', 'create entity')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send(testData.instances.simpleEntity.one
          .replace('<instanceID>one', '<deprecatedID>one2</deprecatedID><instanceID>one3'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .set('X-Action-Notes', 'approving one more time')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {

          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.create');
          logs[0].actor.displayName.should.be.eql('Alice');

          logs[0].details.source.event.should.be.an.Audit();
          logs[0].details.source.event.actor.displayName.should.be.eql('Alice');
          logs[0].details.source.event.loggedAt.should.be.isoDate();
          logs[0].details.source.event.notes.should.be.eql('create entity'); // this confirms that it's the second approval

          logs[0].details.source.submission.should.be.a.Submission();
          logs[0].details.source.submission.xmlFormId.should.be.eql('simpleEntity');
          logs[0].details.source.submission.currentVersion.instanceName.should.be.eql('one');
          logs[0].details.source.submission.currentVersion.submitter.displayName.should.be.eql('Alice');
        });

    }));

    it('should return paginated audit logs of the Entity', testEntities(async (service) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '12', first_name: 'John' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits?offset=1&limit=1')
        .expect(200)
        .then(({ body: logs }) => {
          logs.length.should.equal(1);
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.create');
        });
    }));

    it('should return delete and restore events', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/restore')
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs.map(l => l.action).should.be.eql(['entity.restore', 'entity.delete', 'entity.create']);
        });
    }));
  });

  describe('POST /datasets/:name/entities', () => {

    it('should return notfound if the dataset does not exist', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/nonexistent/entities')
        .expect(404);
    }));

    it('should reject if the user cannot write', testDataset(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.post('/v1/projects/1/datasets/people/entities')
        .expect(403);
    }));

    it('should reject malformed json', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({ broken: 'json' })
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.31);
        });
    }));

    it('should reject creating new entity if dataset not yet published', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people')
        .expect(404);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111aaa',
          label: 'Johnny Doe',
          data: {}
        })
        .expect(404);
    }));

    it('should create an Entity', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111aaa',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.uuid.should.equal('12345678-1234-4123-8234-111111111aaa');
          person.creatorId.should.equal(5);
          person.should.have.property('currentVersion').which.is.an.EntityDef();
          person.currentVersion.should.have.property('label').which.equals('Johnny Doe');
          person.currentVersion.should.have.property('data').which.is.eql({
            first_name: 'Johnny',
            age: '22'
          });
          person.currentVersion.should.have.property('dataReceived').which.is.eql({
            first_name: 'Johnny',
            age: '22',
            label: 'Johnny Doe'
          });
        });
    }));

    it('should generate uuid if one is not provided', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(200)
        .then(({ body: person }) => {
          person.should.be.an.Entity();
          person.uuid.should.be.a.uuid();
          person.creatorId.should.equal(5);
          person.should.have.property('currentVersion').which.is.an.EntityDef();
          person.currentVersion.should.have.property('label').which.equals('Johnny Doe');
          person.currentVersion.should.have.property('data').which.is.eql({
            first_name: 'Johnny',
            age: '22'
          });
          person.currentVersion.should.have.property('dataReceived').which.is.eql({
            first_name: 'Johnny',
            age: '22',
            label: 'Johnny Doe'
          });
        });
    }));

    it('should reject if uuid is not a valid uuid', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: 'bad_uuidv4',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(400);
    }));

    it('should reject if label is blank', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: '',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(400);
    }));


    it('should reject if label is not provided', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(400);
    }));

    it('should reject if uuid is not unique', testEntities(async (service) => {
      // Use testEntities here vs. testDataset to prepopulate with 2 entities
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(409);
    }));

    it('should reject if entity with the same uuid is soft deleted', testEntities(async (service) => {
      // Use testEntities here vs. testDataset to prepopulate with 2 entities
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(409)
        .then(({ body }) => {
          body.message.should.be.eql('The following UUID(s) cannot be used because they are associated with deleted Entities: (12345678-1234-4123-8234-123456789abc).');
        });
    }));

    it('should reject if data properties do not match dataset exactly', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: {
            favorite_color: 'yellow',
            height: '167'
          }
        })
        .expect(400);
    }));

    it('should mark the source as type api', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111aaa',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        });

      // Don't currently have a way to look up the source, when uploaded via API, and check it.
      const typeCounts = await container.all(sql`
      select type, count(*) from entity_defs
      join entity_def_sources on entity_def_sources."id" = entity_defs."sourceId"
      group by type
      order by type asc`);
      typeCounts[0].type.should.equal('api');
      typeCounts[0].count.should.equal(1);
      typeCounts[1].type.should.equal('submission');
      typeCounts[1].count.should.equal(2);
    }));

    it('should log the entity create event in the audit log', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111aaa',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        });

      const audit = await container.Audits.getLatestByAction('entity.create').then(a => a.get());
      audit.actorId.should.equal(5);
      audit.details.entity.uuid.should.eql('12345678-1234-4123-8234-111111111aaa');
      audit.details.entity.dataset.should.eql('people');
    }));
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

    it('should reject if the user cannot update', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');
      await asChelsea.patch('/v1/projects/1/datasets/people/entities/123')
        .expect(403);
    }));

    it('should reject if version or force flag is not provided', testEntities(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(409)
        .then(({ body }) => {
          body.code.should.equal(409.15);
        });
    }));

    it('should reject if version does not match', testEntities(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=0')
        .expect(409)
        .then(({ body }) => {
          body.code.should.equal(409.15);
        });
    }));

    it('should store the entity update source and creator id', testEntities(async (service) => {
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({
          data: { age: '77' }
        })
        .set('User-Agent', 'central/tests')
        .expect(200)
        .then(({ body: person }) => {
          // Data is updated
          person.currentVersion.data.age.should.equal('77');

          // Response is the right shape
          person.should.be.an.Entity();
          person.should.have.property('currentVersion').which.is.an.EntityDef();

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
          person.currentVersion.data.age.should.equal('77');
          person.currentVersion.creatorId.should.equal(6); // bob
          person.creatorId.should.equal(5); // alice - original entity creator
          person.currentVersion.userAgent.should.equal('central/tests');
          person.updatedAt.should.be.a.recentIsoDate();
        });
    }));

    it('should add a source row with type api when updating an entity via PATCH', testEntities(async (service, container) => {
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({
          data: { age: '77' }
        })
        .set('User-Agent', 'central/tests')
        .expect(200);

      // Don't currently have a way to look up the source, when uploaded via API, and check it.
      const typeCounts = await container.all(sql`
      select type, count(*) from entity_defs
      join entity_def_sources on entity_def_sources."id" = entity_defs."sourceId"
      where root = false
      group by type
      order by type asc`);
      typeCounts.length.should.equal(1);
      typeCounts[0].type.should.equal('api');
      typeCounts[0].count.should.equal(1);
    }));

    describe('updating data', () => {
      it('should partially update an Entity', testEntities(async (service) => {
        const asAlice = await service.login('alice');
        const newData = { age: '77', first_name: 'Alan' };

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
          .send({
            data: { age: '77', first_name: 'Alan' }
          })
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.dataReceived.should.eql({ age: '77', first_name: 'Alan' });
            person.currentVersion.should.have.property('data').which.is.eql(newData);
            // label hasn't been updated
            person.currentVersion.should.have.property('label').which.is.equal('Alice (88)');
          });

        // re-get entity to check data
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.dataReceived.should.eql({ age: '77', first_name: 'Alan' });
            person.currentVersion.should.have.property('data').which.is.eql(newData);
            person.currentVersion.should.have.property('label').which.is.equal('Alice (88)');
          });
      }));

      it('should return the latest data after multiple updates', testEntities(async (service) => {
        const asAlice = await service.login('alice');
        const newData = { age: '66', first_name: 'Arnold' };

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            data: { age: '77' }
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            data: { age: '66', first_name: 'Arnold' },
            label: 'Arnold'
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            label: 'Arnold (66)'
          })
          .expect(200);

        // re-get entity to check data
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.should.have.property('data').which.is.eql(newData);
            person.currentVersion.should.have.property('label').which.is.equal('Arnold (66)');
            person.currentVersion.dataReceived.should.eql({ label: 'Arnold (66)' });
          });
      }));

      it('should update the label of an entity', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            label: 'New Label'
          })
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.should.have.property('label').which.is.eql('New Label');
          });

        // re-get entity to check data
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.should.have.property('label').which.is.eql('New Label');
            person.currentVersion.dataReceived.should.have.property('label').which.is.eql('New Label');
            person.currentVersion.dataReceived.should.eql({ label: 'New Label' });
          });
      }));

      it('should reject if updating the label to be empty', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            label: ''
          })
          .expect(400);
      }));

      it('should update an entity with additional properties', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/, 'simpleEntity2')
            .replace(/first_name/, 'city'))
          .set('Content-Type', 'text/xml')
          .expect(200);

        const newData = { age: '88', first_name: 'Alice', city: 'Toronto' };

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            data: { city: 'Toronto' }
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
            person.currentVersion.dataReceived.should.eql({ city: 'Toronto' });
          });
      }));

      it('should let a propery be set to empty string', testEntities(async (service) => {
        const asAlice = await service.login('alice');
        const newData = { age: '88', first_name: '' };

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            data: { first_name: '' }
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
            person.currentVersion.dataReceived.should.eql({ first_name: '' });
          });
      }));

      it('should not accept null property', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            data: { first_name: null }
          })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.11);
            body.message.should.equal('Invalid input data type: expected (first_name) to be (string)');
          });
      }));

      it('should reject if updating property not in dataset', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            data: { favorite_candy: 'chocolate' }
          })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.28);
            body.message.should.equal('The entity is invalid. You specified the dataset property [favorite_candy] which does not exist.');
          });
      }));
    });

    it('should log the entity update event in the audit log', testEntities(async (service, container) => {
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({
          data: { age: '77' }
        })
        .expect(200);

      const audit = await container.Audits.getLatestByAction('entity.update.version').then(a => a.get());
      audit.actorId.should.equal(6);
      audit.details.entity.uuid.should.eql('12345678-1234-4123-8234-123456789abc');
      audit.details.entity.dataset.should.eql('people');
    }));

    describe('resolve conflict', () => {

      const createConflict = async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({ data: { age: '99' } })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // all properties changed
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);
      };

      it('should resolve the conflict without updating data', testService(async (service, container) => {
        await createConflict(service, container);

        const asAlice = await service.login('alice');

        const lastUpdatedAt = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body }) => body.updatedAt);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=3')
          .expect(200)
          .then(({ body }) => {
            body.updatedAt.should.not.be.eql(lastUpdatedAt);
            should(body.conflict).be.null();
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body: person }) => {
            should(person.conflict).be.null();
          });
      }));

      it('should resolve the conflict with updating data', testService(async (service, container) => {
        await createConflict(service, container);

        const asAlice = await service.login('alice');

        const asBob = await service.login('bob');

        await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=3')
          .send({ data: { first_name: 'John', age: '10' } })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body: person }) => {
            should(person.conflict).be.null();

            person.currentVersion.data.age.should.be.eql('10');
            person.currentVersion.data.first_name.should.be.eql('John');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: audits }) => {
            audits[0].action.should.be.eql('entity.update.resolve');
            audits[0].actor.displayName.should.eql('Bob');
          });
      }));

      it('should not resolve without the flag', testService(async (service, container) => {
        await createConflict(service, container);

        const asAlice = await service.login('alice');

        const asBob = await service.login('bob');

        await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=3')
          .send({ data: { first_name: 'John', age: '10' } })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body: person }) => {
            should(person.conflict).not.be.null();

            person.currentVersion.data.age.should.be.eql('10');
            person.currentVersion.data.first_name.should.be.eql('John');
          });
      }));

      it('should resolve the conflict and forcefully update the entity', testService(async (service, container) => {
        await createConflict(service, container);

        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&force=true')
          .send({ data: { first_name: 'John', age: '10' } })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body: person }) => {
            should(person.conflict).be.null();

            person.currentVersion.data.age.should.be.eql('10');
            person.currentVersion.data.first_name.should.be.eql('John');
          });
      }));

      it('should throw error if there is no conflict', testEntities(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true')
          .expect(400)
          .then(({ body }) => {
            body.code.should.be.eql(400.32);
          });
      }));

      it('should reject if version does not match', testService(async (service, container) => {
        await createConflict(service, container);

        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=0')
          .expect(409)
          .then(({ body }) => {
            body.code.should.equal(409.15);
          });
      }));

      it('should forcefully resolve the conflict', testService(async (service, container) => {
        await createConflict(service, container);

        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&force=true')
          .expect(200)
          .then(({ body }) => {
            should(body.conflict).be.null();
          });
      }));

    });

    /* eslint-disable no-console */
    // This is explanatory test where two transaction tries to update the same Entity.
    // `getById` creates an advisory lock which blocks other transactions to do the same.
    // Once first transaction updates the Entity, only then second transaction is able
    // to get the Entity.
    it('should not allow parallel updates to the same Entity', testServiceFullTrx(async (service, container) => {

      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const dataset = await container.Datasets.get(1, 'people', true).then((o) => o.get());
      const actorId = await container.oneFirst(sql`SELECT id FROM actors WHERE "displayName" = 'Alice'`);

      let secondTxWaiting = false;
      let entityLocked = false;

      const transaction1 = container.db.connect(connection => connection.transaction(async tx1 => {
        const containerTx1 = { context: { auth: { actor: Option.of({ id: actorId }) }, headers: [] } };
        queryFuncs(tx1, containerTx1);

        const logger = (action, actee, details) => log(containerTx1.context.auth.actor, action, actee, details);

        const entity = await getById(dataset.id, '12345678-1234-4123-8234-123456789abc', QueryOptions.forUpdate)(containerTx1).then((o) => o.get());

        entityLocked = true;
        console.log('Tx1: entity fetched');

        console.log('Tx1: waiting for 2nd tx to get started');
        await new Promise(resolve => {
          const intervalId = setInterval(async () => {
            if (secondTxWaiting) {
              clearInterval(intervalId);
              resolve();
            }
          }, 1);
        });

        // Assert that other transaction is blocked
        await tx1.any(sql`SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND wait_event_type ='Lock'`)
          .then(r => {
            r.should.not.be.null();
          });

        const updatedEntity = Entity.fromJson({ label: 'Jane', data: { first_name: 'Jane' } }, [{ name: 'first_name' }], dataset, entity);

        const savedEntity = await createVersion(dataset, updatedEntity, null, entity.aux.currentVersion.version + 1, null, 1)(containerTx1);
        console.log('Tx1: entity updated');
        await createVersion.audit(savedEntity, dataset, null, false)(logger)(containerTx1);
      }));

      const transaction2 = container.db.connect(connection => connection.transaction(async tx2 => {
        const containerTx2 = { context: { auth: { actor: Option.of({ id: actorId }) }, headers: [] } };
        queryFuncs(tx2, containerTx2);

        const logger = (action, actee, details) => log(containerTx2.context.auth.actor, action, actee, details);

        console.log('Tx2: waiting for 1st Tx to lock the row');

        await new Promise(resolve => {
          const intervalId = setInterval(() => {
            if (entityLocked) {
              clearInterval(intervalId);
              resolve();
            }
          }, 1);
        });

        console.log('Tx2: looks like 1st tx has locked the row');

        const promise = getById(dataset.id, '12345678-1234-4123-8234-123456789abc', QueryOptions.forUpdate)(containerTx2).then((o) => o.get())
          .then(async (entity) => {
            console.log('Tx2: entity fetched');

            entity.aux.currentVersion.version.should.be.eql(2);
            const updatedEntity = Entity.fromJson({ label: 'Robert', data: { first_name: 'Robert' } }, [{ name: 'first_name' }], dataset, entity);

            const savedEntity = await createVersion(dataset, updatedEntity, null, entity.aux.currentVersion.version + 1, null, 1)(containerTx2);

            console.log('Tx2: entity updated');

            await createVersion.audit(savedEntity, dataset, null, false)(logger)(containerTx2);
          });

        secondTxWaiting = true;

        return promise;
      }));

      await Promise.all([transaction1, transaction2]);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .then(({ body: versions }) => {
          versions[0].data.first_name.should.eql('Alice');
          versions[0].version.should.eql(1);

          // Created by Tx1
          versions[1].data.first_name.should.eql('Jane');
          versions[1].version.should.eql(2);

          // Created by Tx2
          versions[2].data.first_name.should.eql('Robert');
          versions[2].version.should.eql(3);
        });

    }));
    /* eslint-enable no-console */
  });

  describe('DELETE /datasets/:name/entities/:uuid', () => {

    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/nonexistent/entities/123')
        .expect(404);
    }));

    it('should return notfound if the entity does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/123')
        .expect(404);
    }));

    it('should reject if the user cannot delete', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(403);
    }));

    it('should delete an Entity', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });

      await container.Audits.getLatestByAction('entity.delete')
        .then(o => o.get())
        .then(audit => {
          audit.acteeId.should.not.be.null();
          audit.details.entity.uuid.should.be.eql('12345678-1234-4123-8234-123456789abc');
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(404);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body }) => {
          body.filter(e => e.uuid === '12345678-1234-4123-8234-123456789abc').should.be.empty();
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities?deleted=true')
        .expect(200)
        .then(({ body }) => {
          body.filter(e => e.uuid === '12345678-1234-4123-8234-123456789abc').should.not.be.empty();
        });

    }));

  });

  describe('POST /datasets/:name/entities/:uuid/restore', () => {
    it('should reject if the entity has not been deleted', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/restore')
        .expect(404);
    }));

    it('should reject if the entity does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities/nonexistant/restore')
        .expect(404);
    }));

    it('should reject if the user cannot restore', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      // Chelsea cannot restore
      await asChelsea.post('/v1/projects/1/forms/simple/submissions/12345678-1234-4123-8234-123456789abc/restore')
        .expect(403);
    }));

    it('should soft-delete the entity and then restore it', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(404);

      await asAlice.post('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/restore')
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });

      await container.Audits.getLatestByAction('entity.restore')
        .then(o => o.get())
        .then(audit => {
          audit.acteeId.should.not.be.null();
          audit.details.entity.uuid.should.be.eql('12345678-1234-4123-8234-123456789abc');
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.should.be.Entity();
        });
    }));
  });

  // Bulk API operations
  describe('POST /datasets/:name/entities (bulk creation)', () => {
    // Tests that one would expect to find here are found above because this is additional
    // functionality of an existing endpoint:
    // - should return notfound if the dataset does not exist
    // - should reject if the user cannot write
    // - should reject creating new entity if dataset not yet published

    it('should reject malformed entity object json', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({ entities: [{ broken: 'json' }] })
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.31);
          body.message.should.equal('Expected parameters: (label, uuid, data). Got (broken).');
        });
    }));

    it('should reject malformed contents of entity array', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({ entities: ['1', '2', '3'] })
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.31);
          body.message.should.equal('Expected parameters: (label, uuid, data). Got (0).');
        });
    }));

    it('should reject malformed entities array', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({ entities: 'not an array' })
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.31);
          body.message.should.equal('Expected parameters: (entities: [...]). Got (not an array).');
        });
    }));

    it('should reject empty entities array', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({ entities: [] })
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.31);
          body.message.should.equal('Expected parameters: (entities: [...]). Got (empty array).');
        });
    }));

    it('should create Entities in bulk', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .then(({ body }) => {
          body.length.should.equal(0);
        });

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: {
            name: 'people.csv',
            size: 100,
          },
          entities: [
            {
              uuid: '12345678-1234-4123-8234-111111111aaa',
              label: 'Johnny Doe',
              data: {
                first_name: 'Johnny',
                age: '22'
              }
            },
            {
              uuid: '12345678-1234-4123-8234-111111111bbb',
              label: 'Alice',
              data: {
                first_name: 'Alice',
                age: '44'
              }
            },
          ]
        })
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });

      // Entity list has more entities!
      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .then(({ body }) => {
          body.length.should.equal(2);
          body[0].uuid.should.equal('12345678-1234-4123-8234-111111111bbb');
          body[0].currentVersion.label.should.equal('Alice');
          body[1].uuid.should.equal('12345678-1234-4123-8234-111111111aaa');
          body[1].currentVersion.label.should.equal('Johnny Doe');
        });

      // Check data and dataRecieved of each entity
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
          body.currentVersion.dataReceived.should.eql({ age: '22', label: 'Johnny Doe', first_name: 'Johnny' });
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111bbb')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ age: '44', first_name: 'Alice' });
          body.currentVersion.dataReceived.should.eql({ age: '44', label: 'Alice', first_name: 'Alice' });
        });

      // Most recent event IS bulk create
      await asAlice.get('/v1/audits')
        .then(({ body }) => {
          body[0].action.should.equal('entity.bulk.create');
          // the main item stored in the event details is a reference to the entity source id.
          body[0].details.should.have.property('sourceId');
        });
    }));

    it('should generate uuids for entities when no uuid is provided', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .then(({ body }) => {
          body.length.should.equal(0);
        });

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: {
            name: 'people.csv',
            size: 100,
          },
          entities: [
            {
              uuid: '12345678-1234-4123-8234-111111111aaa',
              label: 'Johnny Doe',
              data: {
                first_name: 'Johnny',
                age: '22'
              }
            },
            {
              label: 'Alice',
              data: {
                first_name: 'Alice',
                age: '44'
              }
            },
          ]
        })
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });

      // Used provided UUID and generated other UUID
      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .then(({ body }) => {
          body[0].uuid.should.be.a.uuid();
          body[1].uuid.should.equal('12345678-1234-4123-8234-111111111aaa');
        });
    }));

    describe('bulk create errors', () => {
      it('should not create any entities if one is invalid (missing label)', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-111111111aaa',
                label: '', // label cannot be empty
                data: {
                  first_name: 'Johnny',
                  age: '22'
                }
              },
              {
                uuid: '12345678-1234-4123-8234-111111111bbb',
                label: 'Alice',
                data: {
                  first_name: 'Alice',
                  age: '44'
                }
              },
            ]
          })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.8);
            body.message.should.equal('Unexpected label value (empty string); Label cannot be blank.');
          });

        // Entity list is still empty
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => {
            body.length.should.equal(0);
          });

        // Most recent event is not a bulk create event
        await asAlice.get('/v1/audits')
          .then(({ body }) => {
            body[0].action.should.not.equal('entity.bulk.create');
          });
      }));

      it('should not create any entities if one is invalid (invalid property)', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-111111111aaa',
                label: 'John Doe',
                data: {
                  extra_property_not_in_dataset: 'Not Good',
                  age: '22'
                }
              },
              {
                uuid: '12345678-1234-4123-8234-111111111bbb',
                label: 'Alice',
                data: {
                  first_name: 'Alice',
                  age: '44'
                }
              },
            ]
          })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.28);
            body.message.should.equal('The entity is invalid. You specified the dataset property [extra_property_not_in_dataset] which does not exist.');
          });

        // Entity list is still empty
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => {
            body.length.should.equal(0);
          });

        // Most recent event is not a bulk create event
        await asAlice.get('/v1/audits')
          .then(({ body }) => {
            body[0].action.should.not.equal('entity.bulk.create');
          });
      }));

      it('should not create any entities if one is invalid (invalid UUID)', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-111111111aaa',
                label: 'John Doe',
                data: {
                  first_name: 'John',
                  age: '22'
                }
              },
              {
                uuid: '12345678-not-real-uuid', // invalid uuid
                label: 'Alice',
                data: {
                  first_name: 'Alice',
                  age: '44'
                }
              },
            ]
          })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.11);
            body.message.should.equal('Invalid input data type: expected (uuid) to be (valid version 4 UUID)');
          });

        // Entity list is still empty
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => {
            body.length.should.equal(0);
          });

        // Most recent event is not a bulk create event
        await asAlice.get('/v1/audits')
          .then(({ body }) => {
            body[0].action.should.not.equal('entity.bulk.create');
          });
      }));

      it('should not create any entities there is a UUID collision', testServiceFullTrx(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc', // collision
            label: 'John Doe',
            data: {
              first_name: 'John',
              age: '22'
            }
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => {
            body.length.should.equal(1);
          });

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-123456789abc', // collision
                label: 'John Doe',
                data: {
                  first_name: 'John',
                  age: '22'
                }
              },
              {
                uuid: '12345678-1234-4123-8234-111111111bbb',
                label: 'Alice',
                data: {
                  first_name: 'Alice',
                  age: '44'
                }
              },
            ]
          })
          .expect(409)
          .then(({ body }) => {
            body.code.should.equal(409.3);
            body.message.should.equal('A resource already exists with uuid value(s) of 12345678-1234-4123-8234-123456789abc.');
          });

        // Entity list is still same length as before
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => {
            body.length.should.equal(1); // same as before
          });

        // Most recent event is not a bulk create event
        await asAlice.get('/v1/audits')
          .then(({ body }) => {
            body[0].action.should.not.equal('entity.bulk.create');
          });
      }));

      it('should not create any entities if there is a UUID collision with soft deleted Entity', testServiceFullTrx(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc', // collision
            label: 'John Doe',
            data: {
              first_name: 'John',
              age: '22'
            }
          });

        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => {
            body.length.should.equal(0);
          });

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-123456789abc', // collision
                label: 'John Doe',
                data: {
                  first_name: 'John',
                  age: '22'
                }
              },
              {
                uuid: '12345678-1234-4123-8234-111111111bbb',
                label: 'Alice',
                data: {
                  first_name: 'Alice',
                  age: '44'
                }
              },
            ]
          })
          .expect(409)
          .then(({ body }) => {
            body.code.should.equal(409.19);
            body.message.should.equal('The following UUID(s) cannot be used because they are associated with deleted Entities: (12345678-1234-4123-8234-123456789abc).');
          });

        // Entity list is still same length as before
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => {
            body.length.should.equal(0); // same as before
          });

        // Most recent event is not a bulk create event
        await asAlice.get('/v1/audits')
          .then(({ body }) => {
            body[0].action.should.not.equal('entity.bulk.create');
          });
      }));
    });

    describe('entity source when created through bulk append', () => {
      it('should throw an error if no source is provided', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            entities: [{
              label: 'Alice',
              data: { first_name: 'Alice' }
            }]
          })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.2);
            body.message.should.equal('Required parameter source missing.');
          });
      }));

      it('should throw an error if source name is missing', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {},
            entities: [{
              label: 'Alice',
              data: { first_name: 'Alice' }
            }]
          })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.2);
            body.message.should.equal('Required parameter source.name missing.');
          });
      }));

      it('should save source details in entity version source', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-111111111aaa',
                label: 'Alice',
                data: { first_name: 'Alice' }
              },
              {
                label: 'Emily',
                data: { first_name: 'Emily' }
              },
              {
                label: 'Jane',
                data: { first_name: 'Jane' }
              }
            ]
          })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa/versions')
          .then(({ body: versions }) => {
            versions[0].source.should.eql({ name: 'people.csv', size: 100, count: 3, userAgent: 'central/tests' });
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa/audits')
          .then(({ body: logs }) => {
            logs[0].details.source.should.eql({ name: 'people.csv', size: 100, count: 3, userAgent: 'central/tests' });
          });
      }));

      it('should create entities that share the same source', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-111111111aaa',
                label: 'Johnny Doe',
                data: {
                  first_name: 'Johnny',
                  age: '22'
                }
              },
              {
                uuid: '12345678-1234-4123-8234-111111111bbb',
                label: 'Alice',
                data: {
                  first_name: 'Alice',
                  age: '44'
                }
              },
            ]
          })
          .expect(200);

        const aaaSource = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa/versions')
          .then(({ body: versions }) => versions[0].source);

        aaaSource.should.eql({ name: 'people.csv', size: 100, count: 2, userAgent: null });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111bbb/versions')
          .then(({ body: versions }) => {
            versions[0].source.should.eql(aaaSource);
          });
      }));
    });

    describe('entity audit events when created through bulk append', () => {
      it('should return bulk create event in the audit log for an entity', testDataset(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .set('User-Agent', 'central/tests')
          .send({
            source: {
              name: 'people.csv',
              size: 100,
            },
            entities: [
              {
                uuid: '12345678-1234-4123-8234-111111111aaa',
                label: 'Johnny Doe',
                data: {
                  first_name: 'Johnny',
                  age: '22'
                }
              },
              {
                uuid: '12345678-1234-4123-8234-111111111bbb',
                label: 'Alice',
                data: {
                  first_name: 'Alice',
                  age: '44'
                }
              },
            ]
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa?force=true')
          .send({ data: { age: '33' } })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa/audits')
          .then(({ body: logs }) => {
            // update event
            logs[0].action.should.equal('entity.update.version');
            logs[0].details.source.should.eql({});
            logs[0].details.entity.should.eql({ uuid: '12345678-1234-4123-8234-111111111aaa', dataset: 'people' });

            // bulk create event
            logs[1].action.should.equal('entity.bulk.create');
            logs[1].details.source.should.eql({ name: 'people.csv', size: 100, count: 2, userAgent: 'central/tests' });

            logs.length.should.equal(2);
          });
      }));

      // this test is relevant to bulk events because the audit query is shared
      it('should fetch the correct events for a conflict resolution (no new version)', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        // second version
        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
          .send({ data: { age: '12' } })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // third version: hard conflict - all properties are changed
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // resolve conflict while simultaneously making new version
        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&force=true')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
          .expect(200)
          .then(({ body: versions }) => {
            versions.length.should.equal(3);
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs.length.should.equal(4);
            logs.map(e => e.action).should.eql([
              'entity.update.resolve',
              'entity.update.version',
              'entity.update.version',
              'entity.create'
            ]);
            logs[0].details.source.should.have.property('event');
            //event and source of resolve seems to be the submission create event of that def/version when it should probably be null (api event that didnt create a new version)
          });
      }));

      // this test is relevant to bulk events because the audit query is shared
      it('should fetch the correct events for a conflict resolution that does add a new version', testEntities(async (service, container) => {
        const asAlice = await service.login('alice');

        // second version
        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
          .send({ data: { age: '12' } })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // third version: hard conflict - all properties are changed
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // resolve conflict without making new version
        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&force=true')
          .send({ data: { age: '28' } })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
          .expect(200)
          .then(({ body: versions }) => {
            versions.length.should.equal(4);
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs.length.should.equal(5);
            logs.map(e => e.action).should.eql([
              'entity.update.resolve',
              'entity.update.version',
              'entity.update.version',
              'entity.update.version',
              'entity.create'
            ]);
            logs[0].details.source.should.not.have.property('event');
            logs[0].details.source.should.eql({});
            logs[0].details.entity.should.eql({ uuid: '12345678-1234-4123-8234-123456789abc', dataset: 'people' });

            logs[1].details.source.should.not.have.property('event');
            logs[1].details.source.should.eql({});
            logs[1].details.entity.should.eql({ uuid: '12345678-1234-4123-8234-123456789abc', dataset: 'people' });

            logs[0].details.entityId.should.eql(logs[1].details.entityId);
            logs[0].details.entityDefId.should.eql(logs[1].details.entityDefId);
            // update and resolve are technically the same event and the source of both are empty because it was an API call
          });
      }));
    });
  });

  // Special scenarios
  describe('create new entities from submissions', () => {
    // More success and error cases in test/integration/worker/entity.js
    it('should create entity', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.three)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789bbb')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.label.should.equal('John (40)');
          person.currentVersion.data.should.eql({ age: '40', first_name: 'John' });
          person.currentVersion.version.should.equal(1);
        });
    }));

    it('should not create entity if the label is missing in the submission', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.three
          .replace('<entities:label>John (40)</entities:label>', ''))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789bbb')
        .expect(404);

      await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/three/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.error');
          logs[0].details.problem.problemCode.should.equal(400.2);
          logs[0].details.errorMessage.should.equal('Required parameter label missing.');
        });
    }));

    it('should not create entity if the uuid is missing in the submission', testDataset(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one
          .replace('id="uuid:12345678-1234-4123-8234-123456789abc"', 'id=""'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.error');
          logs[0].details.problem.problemCode.should.equal(400.2);
          logs[0].details.errorMessage.should.equal('Required parameter uuid missing.');
        });
    }));
  });

  describe('entity updates from submissions', () => {
    it('should process multiple updates in a row', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one
          .replace('<instanceID>one</instanceID>', '<instanceID>one-v2</instanceID>')
          .replace('<age>85</age>', '<age>33</age>'))
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions[0].data.should.eql({ age: '22', first_name: 'Johnny' });
          versions[0].version.should.equal(1);

          versions[1].data.should.eql({ age: '85', first_name: 'Alicia' });
          versions[1].version.should.equal(2);

          versions[2].data.should.eql({ age: '33', first_name: 'Alicia' });
          versions[2].version.should.equal(3);
        });
    }));

    it('should update data and label', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.dataReceived.should.eql({ age: '85', first_name: 'Alicia', label: 'Alicia (85)' });
          person.currentVersion.label.should.equal('Alicia (85)');
          person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
        });
    }));

    it('should update only the label', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one
          .replace('<name>Alicia</name>', '')
          .replace('<age>85</age>', ''))
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.dataReceived.should.eql({ label: 'Alicia (85)' });
          person.currentVersion.label.should.equal('Alicia (85)');
          person.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
        });
    }));

    it('should not update label if not included', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one
          .replace('<label>Alicia (85)</label>', ''))
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.dataReceived.should.eql({ age: '85', first_name: 'Alicia' });
          person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
          person.currentVersion.label.should.equal('Johnny Doe');
        });
    }));

    it('should not update label if label is blank', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one
          .replace('<label>Alicia (85)</label>', '<label></label>'))
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.dataReceived.should.eql({ age: '85', first_name: 'Alicia' });
          person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
          person.currentVersion.label.should.equal('Johnny Doe');
        });
    }));

    it('should set field to blank', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one
          .replace('<age>85</age>', '<age></age>'))
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.dataReceived.should.eql({ label: 'Alicia (85)', first_name: 'Alicia', age: '' });
          person.currentVersion.data.first_name.should.eql('Alicia');
          person.currentVersion.data.age.should.eql('');
        });
    }));

    it('should not update field if not included in xml', testEntityUpdates(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one
          .replace('<name>Alicia</name>', '')) // original first_name in entity is Johnny
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.dataReceived.should.eql({ label: 'Alicia (85)', age: '85' });
          person.currentVersion.data.first_name.should.equal('Johnny'); // original first name
          person.currentVersion.data.should.eql({ age: '85', first_name: 'Johnny' });
          person.currentVersion.label.should.equal('Alicia (85)');
        });
    }));

    describe('update error cases', () => {
      // more checks of errors are found in worker/entity tests
      it('should log an error and not update if baseVersion is missing', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('baseVersion="1"', ''))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            should(person.currentVersion.baseVersion).be.null();
          });

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.error');
          });
      }));

      it('should log an error and not update if baseVersion in submission does not exist', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('baseVersion="1"', 'baseVersion="2"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            should(person.currentVersion.baseVersion).be.null();
          });

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.error');
            logs[0].details.problem.problemCode.should.equal(404.9);
            logs[0].details.errorMessage.should.equal('Base version (2) does not exist for entity UUID (12345678-1234-4123-8234-123456789abc) in dataset (people).');
          });
      }));

      it('should log an error and if baseVersion is not an integer', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('baseVersion="1"', 'baseVersion="not_an_integer"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.version.should.equal(1);
          });

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.error');
            logs[0].details.problem.problemCode.should.equal(400.11);
            logs[0].details.errorMessage.should.equal('Invalid input data type: expected (baseVersion) to be (integer)');
          });
      }));
    });

    describe('create and update in a single submission', () => {
      it('should create an entity if it does not yet exist', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1" update="1"')
            .replace('id="12345678-1234-4123-8234-123456789abc"', 'id="12345678-1234-4123-8234-123456789aaa"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.create');
            logs[1].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(1);
          });
      }));

      it('should perform an upsert with blank label', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        // This update should work even with no label
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1" update="1"')
            .replace('<label>Alicia (85)</label>', ''))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.dataReceived.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Johnny Doe');
          });
      }));

      it('should have create error if failed to update non-existent entity but still had error with create (e.g blank label)', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1" update="1"')
            .replace('id="12345678-1234-4123-8234-123456789abc"', 'id="12345678-1234-4123-8234-123456789aaa"')
            .replace('<label>Alicia (85)</label>', ''))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa')
          .expect(404);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.error');
            logs[0].details.problem.problemCode.should.be.eql(400.2);
            logs[0].details.errorMessage.should.be.eql('Required parameter label missing.');
            logs[1].action.should.be.eql('submission.create');
          });
      }));

      it('should update an entity if it does exist', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1" update="1"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.update.version');
            logs[1].action.should.be.eql('submission.create');
          });
      }));

      it('should fail both update and create if uuid exists and base version is wrong', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1" update="1"')
            .replace('baseVersion="1"', 'baseVersion="99"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            // Not updated
            person.currentVersion.version.should.equal(1);
            person.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
            person.currentVersion.label.should.equal('Johnny Doe');
          });

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.error');
            logs[0].details.errorMessage.should.be.eql('Base version (99) does not exist for entity UUID (12345678-1234-4123-8234-123456789abc) in dataset (people).');
            logs[1].action.should.be.eql('submission.create');
          });
      }));

      it('should fail both update and create on error like invalid uuid', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1" update="1"')
            .replace('id="12345678-1234-4123-8234-123456789abc"', 'id="not_a_valid_uuid"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            // Not updated
            person.currentVersion.version.should.equal(1);
            person.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
            person.currentVersion.label.should.equal('Johnny Doe');
          });

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.error');
            logs[1].action.should.be.eql('submission.create');
          });
      }));

      it('should create entity when both create and update are true but baseVersion is empty', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('id="12345678-1234-4123-8234-123456789abc"', 'id="12345678-1234-4123-8234-123456789ddd"')
            .replace('update="1"', 'create="1" update="1"')
            .replace('baseVersion="1"', 'baseVersion=""'))
          .expect(200);

        await exhaust(container);
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body: people }) => {
            // existing entity + new entity
            people.length.should.be.eql(2);
          });
      }));

      it('should log error when both create and update are true, baseVersion is empty but entity uuid exists', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        // This submission uses an existing entity uuid
        // has create and update both set to true
        // and is missing a baseVersion.
        // This will attempt to update but fail because it finds no
        // baseVersion to parse in the update case
        // and will then attempt to create but fail because
        // the entity uuid does actually exist.
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1" update="1"')
            .replace('baseVersion="1"', 'baseVersion=""'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.error');
            logs[0].details.problem.problemCode.should.be.eql(409.3);
            logs[0].details.errorMessage.should.be.eql('A resource already exists with uuid value(s) of 12345678-1234-4123-8234-123456789abc.');
            logs[1].action.should.be.eql('submission.create');
          });
      }));
    });

    // 10 examples described in central issue #517
    describe('only take one entity action per submission', () => {
      // Example 1
      it('should create an entity from submission edited to have create flag', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace('create="1"', 'create="0"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(404);

        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.simpleEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.create');
            logs[1].action.should.be.eql('submission.update.version');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '88', first_name: 'Alice' });
            person.currentVersion.label.should.equal('Alice (88)');
            person.currentVersion.version.should.equal(1);
          });
      }));

      // Example 2
      it('should create an entity from approved submission edited to have create flag', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace('create="1"', 'create="0"'))
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(404);

        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.simpleEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.create');
            logs[1].action.should.be.eql('submission.update');
            logs[2].action.should.be.eql('submission.update.version');
            logs[3].action.should.be.eql('submission.update');
            logs[4].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '88', first_name: 'Alice' });
            person.currentVersion.label.should.equal('Alice (88)');
            person.currentVersion.version.should.equal(1);
          });
      }));

      // Example 3
      it('should not create second entity with new uuid from edited submission', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);

        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.simpleEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')
            .replace('id="uuid:12345678-1234-4123-8234-123456789abc"', 'id="uuid:12345678-1234-4123-8234-123456789aaa"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa')
          .expect(404);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('submission.update.version');
            logs[1].action.should.be.eql('entity.create');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '88', first_name: 'Alice' });
            person.currentVersion.label.should.equal('Alice (88)');
            person.currentVersion.version.should.equal(1);
          });
      }));

      // Example 4
      // update is not well-formed, doesn't include baseVersion, but it doesn't run
      it('should not update a entity from edited sub if sub already created entity', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);

        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.simpleEntity.one
            .replace('create="1"', 'update="1"')
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')
            .replace('id="uuid:12345678-1234-4123-8234-123456789abc"', 'id="uuid:12345678-1234-4123-8234-123456789aaa"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('submission.update.version');
            logs[1].action.should.be.eql('entity.create');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '88', first_name: 'Alice' });
            person.currentVersion.label.should.equal('Alice (88)');
            person.currentVersion.version.should.equal(1);
          });
      }));

      // Example 5
      it('should not update same entity from edited sub if sub already created entity', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);

        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.simpleEntity.one
            .replace('create="1"', 'update="1"')
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('submission.update.version');
            logs[1].action.should.be.eql('entity.create');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '88', first_name: 'Alice' });
            person.currentVersion.label.should.equal('Alice (88)');
            person.currentVersion.version.should.equal(1);
          });
      }));

      // Example 6
      it('should update entity when submission is edited to set update to true', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        // Forms already in place
        // one entity exists already
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'update="0"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
            person.currentVersion.label.should.equal('Johnny Doe');
            person.currentVersion.version.should.equal(1);
          });

        await asAlice.put('/v1/projects/1/forms/updateEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.updateEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.update.version');
            logs[1].action.should.be.eql('submission.update.version');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });
      }));

      // Example 7
      it('should not update different entity when submission previously updated an entity', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });

        await asAlice.put('/v1/projects/1/forms/updateEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.updateEntity.one
            .replace('id="12345678-1234-4123-8234-123456789abc"', 'id="12345678-1234-4123-8234-123456789aaa"')
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('submission.update.version');
            logs[1].action.should.be.eql('entity.update.version');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });
      }));

      // Example 8
      it('should not re-update entity when submission previously updated an entity', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });

        await asAlice.put('/v1/projects/1/forms/updateEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.updateEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('submission.update.version');
            logs[1].action.should.be.eql('entity.update.version');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });
      }));

      // Example 9
      it('should update entity after editing submission to reference valid entity', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        // this entity uuid does not exist to be updated
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('id="12345678-1234-4123-8234-123456789abc"', 'id="12345678-1234-4123-8234-123456789aaa"'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
            person.currentVersion.label.should.equal('Johnny Doe');
            person.currentVersion.version.should.equal(1);
          });

        // now this points to an entity uuid that does exist
        await asAlice.put('/v1/projects/1/forms/updateEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.updateEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('entity.update.version');
            logs[1].action.should.be.eql('submission.update.version');
            logs[2].action.should.be.eql('entity.error');
            logs[3].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });
      }));

      // Example 10
      it('should not create entity after sub updates an entity', testEntityUpdates(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });

        // this says to create a new entity
        await asAlice.put('/v1/projects/1/forms/updateEntity/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.updateEntity.one
            .replace('update="1"', 'create="1"')
            .replace('id="12345678-1234-4123-8234-123456789abc"', 'id="12345678-1234-4123-8234-123456789aaa"')
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.be.eql('submission.update.version');
            logs[1].action.should.be.eql('entity.update.version');
            logs[2].action.should.be.eql('submission.create');
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.should.eql({ age: '85', first_name: 'Alicia' });
            person.currentVersion.label.should.equal('Alicia (85)');
            person.currentVersion.version.should.equal(2);
          });
      }));
    });
  });

  describe('permitted entity actions', () => {
    it('should result in an error for an update from a create form', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one
          .replace('<instanceID>one</instanceID>', '<instanceID>another</instanceID>')
          .replace('create="1"', 'update="1"'))
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);
      const { body: audits } = await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/another/audits')
        .expect(200);
      const actions = audits.map(audit => audit.action);
      actions.should.eql(['entity.error', 'submission.create']);
      audits[0].details.should.containEql({
        problem: {
          problemCode: 403.2,
          problemDetails: { action: 'update', permitted: ['create'] }
        },
        errorMessage: 'The submission attempts an entity update, but the form does not permit that action. The form permits the following actions: create.'
      });
    }));

    it('should result in an error for a create from an update form', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one
          .replace('update="1"', 'create="1"'))
        .expect(200);
      await exhaust(container);
      const { body: audits } = await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
        .expect(200);
      const actions = audits.map(audit => audit.action);
      actions.should.eql(['entity.error', 'submission.create']);
      audits[0].details.should.containEql({
        problem: {
          problemCode: 403.2,
          problemDetails: { action: 'create', permitted: ['update'] }
        },
        errorMessage: 'The submission attempts an entity create, but the form does not permit that action. The form permits the following actions: update.'
      });
    }));
  });


  describe('increased bodyParser json request limit for bulk entity creation', () => {
    it('should reject >250kb requests to non-entity endpoint', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      // 250kb limit = 256000 bytes (1024 bytes per kb)
      await asAlice.post('/v1/projects/1/datasets')
        .send({ name: 'x'.repeat(256001) })
        .expect(400)
        .then(({ body }) => {
          body.should.eql({
            code: 400.36,
            message: 'Request body too large.',
          });
        });
    }));

    it('should allow >250kb requests to bulk entity endpoint', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      // 250kb limit = 256000 bytes (1024 bytes per kb)
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({ source: { name: 'file.csv' }, entities: [{ label: 'x'.repeat(256001) }] })
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });
    }));

    it('should allow >250kb requests to bulk entity endpoint with query parameters', testDataset(async (service) => {
      const asAlice = await service.login('alice');

      // query parameters are not currently used in this endpoint
      await asAlice.post('/v1/projects/1/datasets/people/entities?foo=bar')
        .send({ source: { name: 'file.csv' }, entities: [{ label: 'x'.repeat(256001) }] })
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });
    }));
  });
});
