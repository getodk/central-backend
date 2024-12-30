const should = require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { v4: uuid } = require('uuid');

const appPath = require('app-root-path');
const Problem = require('../../../lib/util/problem');
const { exhaust } = require(appPath + '/lib/worker/worker');

const createProject = (user) => user.post('/v1/projects')
  .send({ name: 'a project ' + new Date().getTime() })
  .expect(200)
  .then(({ body: project }) => project.id);

const createEntities = async (user, count, projectId, datasetName) => {
  const uuids = [];
  for (let i = 0; i < count; i += 1) {
    const _uuid = uuid();
    // eslint-disable-next-line no-await-in-loop
    await user.post(`/v1/projects/${projectId}/datasets/${datasetName}/entities`)
      .send({
        uuid: _uuid,
        label: 'John Doe'
      })
      .expect(200);
    uuids.push(_uuid);
  }
  return uuids;
};

const createEntitiesViaSubmissions = async (user, container, count) => {
  const uuids = [];
  for (let i = 0; i < count; i += 1) {
    const _uuid = uuid();
    // eslint-disable-next-line no-await-in-loop
    await user.post('/v1/projects/1/forms/simpleEntity/submissions')
      .send(testData.instances.simpleEntity.one
        .replace(/one/g, `submission${i}`)
        .replace(/88/g, i + 1)
        .replace('uuid:12345678-1234-4123-8234-123456789abc', _uuid))
      .set('Content-Type', 'application/xml')
      .expect(200);
    uuids.push(_uuid);
  }
  await exhaust(container);
  return uuids;
};

const deleteEntities = async (user, uuids, projectId, datasetName) => {
  for (const _uuid of uuids) {
    // eslint-disable-next-line no-await-in-loop
    await user.delete(`/v1/projects/${projectId}/datasets/${datasetName}/entities/${_uuid}`)
      .expect(200);
  }
};

const createDataset = (user, projectId, name) =>
  user.post(`/v1/projects/${projectId}/datasets`)
    .send({ name });

const createDeletedEntities = async (user, count, { datasetName='people', project = 1 } = {}) => {
  await createDataset(user, project, datasetName);
  const uuids = await createEntities(user, count, project, datasetName);
  await deleteEntities(user, uuids, project, datasetName);
  return uuids;
};

describe('query module entities purge', () => {

  describe('entities purge arguments', () => {
    it('should purge a specific entity', testService(async (service, { Entities, oneFirst }) => {
      const asAlice = await service.login('alice');

      const uuids = await createDeletedEntities(asAlice, 2);

      // Purge Entities here should not purge anything because they were in the trash less than 30 days
      let purgeCount = await Entities.purge();
      purgeCount.should.equal(0);

      // But we should be able to force purge an Entity
      // specified by projectId, datasetName and uuid
      purgeCount = await Entities.purge(true, 1, 'people', uuids[0]);
      purgeCount.should.equal(1);

      // One (soft-deleted) entity should still be in the database
      const entityCount = await oneFirst(sql`select count(*) from entities`);
      entityCount.should.equal(1);
    }));

    it('should purge deleted entities, which were created via submissions', testService(async (service, container) => {
      const { Entities, oneFirst } = container;
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      const uuids = await createEntitiesViaSubmissions(asAlice, container, 2);

      await deleteEntities(asAlice, uuids, 1, 'people');

      const purgeCount = await Entities.purge(true, 1, 'people', uuids[0]);
      purgeCount.should.equal(1);

      // One (soft-deleted) entity should still be in the database
      const entityCount = await oneFirst(sql`select count(*) from entities`);
      entityCount.should.equal(1);
    }));

    it('should purge all deleted entities of a dataset', testService(async (service, { Entities, all }) => {
      const asAlice = await service.login('alice');

      await createDeletedEntities(asAlice, 2, { datasetName: 'people' });
      const treeUuids = await createDeletedEntities(asAlice, 2, { datasetName: 'trees' });

      const purgeCount = await Entities.purge(true, 1, 'people');
      purgeCount.should.equal(2);

      // 'trees' deleted entities are still there
      const remainingEntities = await all(sql`select uuid from entities`);
      remainingEntities.map(e => e.uuid).should.containDeep(treeUuids);
    }));

    it('should purge all deleted entities under a project', testService(async (service, { Entities, all }) => {
      const asAlice = await service.login('alice');

      await createDeletedEntities(asAlice, 2, { datasetName: 'people', project: 1 });
      await createDeletedEntities(asAlice, 2, { datasetName: 'trees', project: 1 });

      const secondProjectId = await createProject(asAlice);
      const catsUuids = await createDeletedEntities(asAlice, 2, { datasetName: 'cats', project: secondProjectId });
      const dogsUuids = await createDeletedEntities(asAlice, 2, { datasetName: 'dogs', project: secondProjectId });

      // purging all deleted entities of project 1
      const purgeCount = await Entities.purge(true, 1);
      purgeCount.should.equal(4);

      const remainingEntities = await all(sql`select uuid from entities`);
      remainingEntities.map(e => e.uuid).should.containDeep([...catsUuids, ...dogsUuids]);
    }));

    it('should purge all deleted entities under a project', testService(async (service, { Entities, oneFirst }) => {
      const asAlice = await service.login('alice');

      await createDeletedEntities(asAlice, 2, { datasetName: 'people', project: 1 });
      await createDeletedEntities(asAlice, 2, { datasetName: 'trees', project: 1 });

      const secondProjectId = await createProject(asAlice);
      await createDeletedEntities(asAlice, 2, { datasetName: 'cats', project: secondProjectId });
      await createDeletedEntities(asAlice, 2, { datasetName: 'dogs', project: secondProjectId });

      // purging all deleted entities
      const purgeCount = await Entities.purge(true);
      purgeCount.should.equal(8);

      // nothing should be there
      const entityCount = await oneFirst(sql`select count(*) from entities`);
      entityCount.should.equal(0);
    }));

    const PROVIDE_ALL = 'Must specify projectId and datasetName to purge a specify entity.';
    const PROVIDE_PROJECT_ID = 'Must specify projectId to purge all entities of a dataset/entity-list.';
    const cases = [
      { description: ' when entityUuid specified without projectId and datasetName',
        projectId: false, datasetName: false, entityUuid: true, expectedError: PROVIDE_ALL },
      { description: ' when entityUuid specified without projectId',
        projectId: false, datasetName: true, entityUuid: true, expectedError: PROVIDE_ALL },
      { description: ' when entityUuid specified without datasetName',
        projectId: true, datasetName: false, entityUuid: true, expectedError: PROVIDE_ALL },
      { description: ' when datasetName specified without projectId',
        projectId: false, datasetName: true, entityUuid: false, expectedError: PROVIDE_PROJECT_ID },
    ];
    cases.forEach(c =>
      it(`should throw an error ${c.description}`, testService(async (service, { Entities }) => {
        const asAlice = await service.login('alice');

        const uuids = await createDeletedEntities(asAlice, 1);

        (() => {
          Entities.purge(
            true,
            c.projectId ? 1 : null,
            c.datasetName ? 'people' : null,
            c.entityUuid ? uuids[0] : null
          );
        }).should.throw(Problem.internal.unknown({
          error: c.expectedError
        }));
      }))
    );
  });

  describe('30 day time limit', () => {
    it('should purge multiple entities deleted over 30 days ago', testService(async (service, { Entities, all, run }) => {
      const asAlice = await service.login('alice');

      await createDeletedEntities(asAlice, 2);

      // Mark two as deleted a long time ago
      await run(sql`update entities set "deletedAt" = '1999-1-1' where "deletedAt" is not null`);

      // More recent delete, within 30 day window
      const recentUuids = await createDeletedEntities(asAlice, 2);

      const purgeCount = await Entities.purge();
      purgeCount.should.equal(2);

      // Recently deleted entities are not purged
      const remainingEntities = await all(sql`select uuid from entities`);
      remainingEntities.map(e => e.uuid).should.containDeep(recentUuids);
    }));

    it('should purge recently deleted entities when forced', testService(async (service, { Entities }) => {
      const asAlice = await service.login('alice');

      await createDeletedEntities(asAlice, 2);

      const purgeCount = await Entities.purge();
      purgeCount.should.equal(0);
    }));
  });

  describe('deep cleanup of all submission artifacts', () => {

    it('should purge all versions of a deleted submission', testService(async (service, { Entities, all }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');

      const uuids = await createEntities(asAlice, 2, 1, 'people');

      // Edit the Entity
      await asAlice.patch(`/v1/projects/1/datasets/people/entities/${uuids[0]}?baseVersion=1`)
        .send({ label: 'edited' })
        .expect(200);

      // Just delete the first Entity
      await deleteEntities(asAlice, [uuids[0]], 1, 'people');

      // Purge the Entities
      const purgedCount = await Entities.purge(true);
      purgedCount.should.be.eql(1);

      // Check that the entity is deleted
      const remainingEntity = await all(sql`select * from entities`);
      remainingEntity.map(e => e.uuid).should.containDeep([uuids[1]]);

      // Check that entity defs are also deleted
      const remainingEntityDefs = await all(sql`select * from entity_defs`);
      remainingEntityDefs.map(def => def.entityId).should.containDeep(remainingEntity.map(e => e.id));
    }));

    it('should redact notes of a deleted entity sent with x-action-notes', testService(async (service, { Entities, oneFirst }) => {
      const asAlice = await service.login('alice');

      // Create a dataset
      await createDataset(asAlice, 1, 'people');

      // Create an entity with action notes
      const _uuid = uuid();
      await asAlice.post(`/v1/projects/1/datasets/people/entities`)
        .send({ uuid: _uuid, label: 'John Doe' })
        .set('X-Action-Notes', 'a note about the entity')
        .expect(200);

      // Check that the note exists in the entity's audit log
      await asAlice.get(`/v1/projects/1/datasets/people/entities/${_uuid}/audits`)
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          body[0].notes.should.equal('a note about the entity');
        });

      // Delete the entity
      await asAlice.delete(`/v1/projects/1/datasets/people/entities/${_uuid}`);

      // Purge the entity
      await Entities.purge(true);

      // Look at what is in the audit log via the database because the entity is deleted
      const auditNotes = await oneFirst(sql`select notes from audits where action = 'entity.create'`);

      // Check that the note is redacted
      should(auditNotes).be.null();
    }));

    it('should purge entity sources', testService(async (service, container) => {
      const { Entities, oneFirst } = container;
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      const uuids = await createEntitiesViaSubmissions(asAlice, container, 2);

      let sourcesCount = await oneFirst(sql`select count(1) from entity_def_sources`);
      sourcesCount.should.be.equal(2);

      await deleteEntities(asAlice, uuids, 1, 'people');

      await Entities.purge(true);

      sourcesCount = await oneFirst(sql`select count(1) from entity_def_sources`);
      sourcesCount.should.be.equal(0);
    }));

    it('should purge submission backlog for entities', testService(async (service, container) => {
      const { Entities, oneFirst } = container;
      const asAlice = await service.login('alice');

      // Publish a form that will set up the dataset with properties
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.offlineEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const uuids = ['12345678-1234-4123-8234-123456789abc'];

      // Create an entity via the API (to be updated offline)
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: uuids[0],
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      await exhaust(container);

      const branchId = uuid();

      // Send second update in first
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update1')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('<status>arrived</status>', '<status>working</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      let backlogCount = await oneFirst(sql`select count(1) from entity_submission_backlog`);
      backlogCount.should.be.equal(1);

      await deleteEntities(asAlice, uuids, 1, 'people');

      await Entities.purge(true);

      backlogCount = await oneFirst(sql`select count(1) from entity_submission_backlog`);
      backlogCount.should.be.equal(0);
    }));
  });

  describe('restrict recreation with same uuid', () => {
    it('should not allow reuse of purged uuid when creating single entity', testService(async (service, { Entities }) => {
      const asAlice = await service.login('alice');

      const uuids = await createDeletedEntities(asAlice, 2);

      const purgeCount = await Entities.purge(true);
      purgeCount.should.equal(2);

      await asAlice.post(`/v1/projects/1/datasets/people/entities`)
        .send({
          uuid: uuids[0],
          label: 'John Doe'
        })
        .expect(409)
        .then(({ body }) => {
          body.details.values.should.eql(uuids[0]);
        });
    }));

    it('should not allow reuse of purged uuid when creating bulk entities', testService(async (service, { Entities }) => {
      const asAlice = await service.login('alice');

      const uuids = await createDeletedEntities(asAlice, 2);

      const purgeCount = await Entities.purge(true);
      purgeCount.should.equal(2);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: {
            name: 'people.csv',
            size: 100,
          },
          entities: [
            {
              uuid: uuids[0],
              label: 'Johnny Doe'
            },
            {
              uuid: uuids[1],
              label: 'Alice'
            },
          ]
        })
        .expect(409)
        .then(({ body }) => {
          uuids.forEach(i => body.details.values.includes(i).should.be.true);
        });
    }));
  });

  describe('entity.purge audit event', () => {
    it('should log a purge event in the audit log when purging submissions', testService(async (service, { Entities }) => {
      const asAlice = await service.login('alice');

      const uuids = await createDeletedEntities(asAlice, 2);

      // Purge entities
      await Entities.purge(true);

      await asAlice.get('/v1/audits')
        .then(({ body }) => {
          body.filter((a) => a.action === 'entities.purge').length.should.equal(1);
          body[0].details.entitiesDeleted.should.eql(2);
          body[0].details.entityUuids.should.containDeep(uuids);
        });
    }));

    it('should not log event if no entities purged', testService(async (service, { Entities }) => {
      const asAlice = await service.login('alice');
      // No deleted entities exist here to purge
      await Entities.purge(true);

      await asAlice.get('/v1/audits')
        .then(({ body }) => {
          body.filter((a) => a.action === 'entities.purge').length.should.equal(0);
        });
    }));
  });
});
