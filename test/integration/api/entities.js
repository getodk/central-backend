const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { sql } = require('slonik');

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

      await container.run(sql`UPDATE actors SET "createdAt" = '2020-01-01' WHERE "displayName" = 'Alice'`);
      await container.run(sql`UPDATE actors SET "createdAt" = '2021-01-01' WHERE "displayName" = 'Bob'`);

      await container.run(sql`UPDATE entities SET "createdAt" = '2022-01-01', "updatedAt" = '2023-01-01' WHERE uuid = '12345678-1234-4123-8234-123456789abc'`);

      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2022-01-01' WHERE label = 'Alice (88)'`);
      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2023-01-01' WHERE label = 'two'`);

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
        .then(({ body: person, headers }) => {
          headers.etag.should.be.eql('"1"');

          person.should.be.an.Entity();
          person.should.have.property('currentVersion').which.is.an.EntityDef();
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
          person.currentVersion.should.have.property('data').which.is.eql({
            age: '88',
            first_name: 'Alice'
          });
        });
    }));

    it('should not mince the object properties', testEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ label: 'two' })
        .expect(200);

      await container.run(sql`UPDATE actors SET "createdAt" = '2020-01-01' WHERE "displayName" = 'Alice'`);
      await container.run(sql`UPDATE actors SET "createdAt" = '2021-01-01' WHERE "displayName" = 'Bob'`);

      await container.run(sql`UPDATE entities SET "createdAt" = '2022-01-01', "updatedAt" = '2023-01-01'`);

      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2022-01-01' WHERE label = 'Alice (88)'`);
      await container.run(sql`UPDATE entity_defs SET "createdAt" = '2023-01-01' WHERE label = 'two'`);

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

    it('should return 304 not changed ', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('If-None-Match', '"1"')
        .expect(304);
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
            v.should.be.an.EntityDef();
            v.should.have.property('data');
          });

          versions[1].data.should.be.eql({ age: '12', first_name: 'John' });
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
            v.should.have.property('data');
          });

          versions[0].creator.displayName.should.be.eql('Alice');
          versions[1].creator.displayName.should.be.eql('Bob');

          versions[1].data.should.be.eql({ age: '12', first_name: 'John' });
        });
    }));

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

    it('should return audit logs of the Entity', testEntities(async (service) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asBob.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '12', first_name: 'John' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].should.be.an.Audit();
          logs[0].action.should.be.eql('entity.update.version');
          logs[0].details.entity.uuid.should.be.eql('12345678-1234-4123-8234-123456789abc');
          logs[0].actor.displayName.should.be.eql('Bob');

          logs[1].should.be.an.Audit();
          logs[1].action.should.be.eql('entity.create');
          logs[1].actor.displayName.should.be.eql('Alice');

          logs[1].details.sourceEvent.should.be.an.Audit();
          logs[1].details.sourceEvent.actor.displayName.should.be.eql('Alice');
          logs[1].details.sourceEvent.loggedAt.should.be.isoDate();

          logs[1].details.submission.should.be.a.Submission();
          logs[1].details.submission.xmlFormId.should.be.eql('simpleEntity');
          logs[1].details.submission.currentVersion.instanceName.should.be.eql('one');
          logs[1].details.submission.currentVersion.submitter.displayName.should.be.eql('Alice');
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

          logs[0].details.submission.should.be.a.Submission();
          logs[0].details.submission.xmlFormId.should.be.eql('simpleEntity');
          logs[0].details.submission.currentVersion.instanceName.should.be.eql('new instance name');
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

          logs[0].details.sourceEvent.should.be.an.Audit();
          logs[0].details.sourceEvent.actor.displayName.should.be.eql('Alice');
          logs[0].details.sourceEvent.loggedAt.should.be.isoDate();

          logs[0].details.should.not.have.property('submission');

          logs[0].details.submissionCreate.details.instanceId.should.be.eql('one');
          logs[0].details.submissionCreate.actor.displayName.should.be.eql('Alice');
          logs[0].details.submissionCreate.loggedAt.should.be.isoDate();
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

          logs[0].details.sourceEvent.should.be.an.Audit();
          logs[0].details.sourceEvent.actor.displayName.should.be.eql('Alice');
          logs[0].details.sourceEvent.loggedAt.should.be.isoDate();

          logs[0].details.should.not.have.property('submission');

          logs[0].details.submissionCreate.details.instanceId.should.be.eql('one');
          logs[0].details.submissionCreate.actor.displayName.should.be.eql('Alice');
          logs[0].details.submissionCreate.loggedAt.should.be.isoDate();
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

          logs[0].details.sourceEvent.should.be.an.Audit();
          logs[0].details.sourceEvent.actor.displayName.should.be.eql('Alice');
          logs[0].details.sourceEvent.loggedAt.should.be.isoDate();
          logs[0].details.sourceEvent.notes.should.be.eql('create entity'); // this confirms that it's the second approval

          logs[0].details.submission.should.be.a.Submission();
          logs[0].details.submission.xmlFormId.should.be.eql('simpleEntity');
          logs[0].details.submission.currentVersion.instanceName.should.be.eql('one');
          logs[0].details.submission.currentVersion.submitter.displayName.should.be.eql('Alice');
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
        });
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
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .set('If-Match', '"0"')
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

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .set('If-Match', '"1"')
          .send({
            data: { age: '77', first_name: 'Alan' }
          })
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.should.have.property('data').which.is.eql(newData);
            // label hasn't been updated
            person.currentVersion.should.have.property('label').which.is.equal('Alice (88)');
          });

        // re-get entity to check data
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
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

    it('should reject if the user cannot read', testEntities(async (service) => {
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
          audit.details.uuid.should.be.eql('12345678-1234-4123-8234-123456789abc');
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
});
