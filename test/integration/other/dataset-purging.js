const should = require('should');
const { sql } = require('slonik');
const { map } = require('ramda');
const { v4: uuid } = require('uuid');

const { testService } = require('../setup');
const testData = require('../../data/xml');

const appRoot = require('app-root-path');

const { exhaust } = require(appRoot + '/lib/worker/worker');
const { createDataset, createEntities, deleteEntities, createProject } = require('../../util/entities');

const createDatasetFromForm = async (user, projectId) => {
  // create form
  await user.post(`/v1/projects/${projectId}/forms?publish=true`)
    .set('Content-Type', 'application/xml')
    .send(testData.forms.simpleEntity)
    .expect(200);

  // unlink dataset from form
  const formWithoutEntity = testData.forms.simpleEntity
    .replace('orx:version="1.0"', 'orx:version="2.0"')
    .replace(/<meta>[\s\S]*?<\/meta>/g, '')
    .replace(/entities:saveto=".*"/g, '');

  await user.post('/v1/projects/1/forms/simpleEntity/draft?ignoreWarnings=true')
    .send(formWithoutEntity)
    .set('Content-Type', 'application/xml')
    .expect(200);

  await user.post('/v1/projects/1/forms/simpleEntity/draft/publish')
    .expect(200);
};

const deleteDatasets = async (user, names, projectId) => {
  for (const datasetName of names) {
    // eslint-disable-next-line no-await-in-loop
    await user.delete(`/v1/projects/${projectId}/datasets/${datasetName}`)
      .expect(200);
  }
};

describe('query module dataset purge', () => {

  describe('datasets purge arguments', () => {
    it('should purge a specific dataset by name and project id', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');
      await createDataset(asAlice, 1, 'households');
      await createDataset(asAlice, 1, 'trees');

      await deleteDatasets(asAlice, ['people', 'households'], 1);

      // Force purge a Dataset specified by projectId and datasetName
      const purgeCount = await Datasets.purge(true, 1, 'people');
      purgeCount.should.equal(1);

      // Two dataset should still be in the database, one soft-deleted and one not deleted
      await oneFirst(sql`select count(*) from datasets`)
        .then(count => count.should.equal(2));

      // The other deleted dataset should still be present
      await oneFirst(sql`select count(*) from datasets where name='households' and "deletedAt" is not null`)
        .then(count => count.should.equal(1));
    }));

    it('should purge multiple datasets by name if more than one have been deleted', testService(async (service, { Datasets }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');
      await deleteDatasets(asAlice, ['people'], 1);

      await createDataset(asAlice, 1, 'people');
      await deleteDatasets(asAlice, ['people'], 1);

      // Should purge both deleted datasets in project 1 named "people"
      const purgeCount = await Datasets.purge(true, 1, 'people');
      purgeCount.should.equal(2);
    }));

    it('should purge dataset by name only within specified project', testService(async (service, { Datasets }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');
      await deleteDatasets(asAlice, ['people'], 1);

      const newProjectId = await createProject(asAlice);

      await createDataset(asAlice, newProjectId, 'people');
      await deleteDatasets(asAlice, ['people'], newProjectId);

      // Should purge one dataset in the new project
      const purgeCount = await Datasets.purge(true, newProjectId, 'people');
      purgeCount.should.equal(1);
    }));

    it('should purge dataset by name without disrupting published dataset of same name', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');
      await deleteDatasets(asAlice, ['people'], 1);

      await createDataset(asAlice, 1, 'people');

      // Should purge one dataset in the new project
      const purgeCount = await Datasets.purge(true, 1, 'people');
      purgeCount.should.equal(1);

      // Non-deleted dataset with the same name should remain
      await oneFirst(sql`select count(*) from datasets where name = 'people'`)
        .then(count => count.should.equal(1));
    }));

    it('should purge a specific dataset by numeric id', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');
      const peopleId = await oneFirst(sql`select id from datasets where name='people' and "deletedAt" is null`);
      await deleteDatasets(asAlice, ['people'], 1);

      await createDataset(asAlice, 1, 'people');
      const peopleIdNew = await oneFirst(sql`select id from datasets where name='people' and "deletedAt" is null`);
      await deleteDatasets(asAlice, ['people'], 1);

      // Force purge a Dataset specified by projectId and datasetName
      let purgeCount = await Datasets.purge(true, null, null, peopleId);
      purgeCount.should.equal(1);

      // Other dataset should still be in the database
      await oneFirst(sql`select count(*) from datasets`)
        .then(count => count.should.equal(1));

      // Should be able to purge this other dataset by ID
      purgeCount = await Datasets.purge(true, null, null, peopleIdNew);
      purgeCount.should.equal(1);

      // No datasets should remain
      await oneFirst(sql`select count(*) from datasets`)
        .then(count => count.should.equal(0));
    }));
  });

  describe('30 day time limit', () => {
    it('should purge multiple entities deleted over 30 days ago', testService(async (service, { Datasets, all, run }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');
      await createDataset(asAlice, 1, 'households');
      await createDataset(asAlice, 1, 'trees');
      await createDataset(asAlice, 1, 'plants');

      await deleteDatasets(asAlice, ['people', 'households'], 1);

      // Mark two as deleted a long time ago
      await run(sql`update datasets set "deletedAt" = '1999-1-1' where "deletedAt" is not null`);

      // Third and forth datasets deleted within 30 day window
      await deleteDatasets(asAlice, ['trees', 'plants'], 1);

      // Should purge two datasets deleted a long time ago
      const purgeCount = await Datasets.purge();
      purgeCount.should.equal(2);

      // Recently deleted datasets are not purged
      await all(sql`select name from datasets`)
        .then(remainingDatasets => remainingDatasets.map(d => d.name).should.containDeep(['trees', 'plants']));
    }));

    it('should not purge datasets deleted within 30 day window', testService(async (service, { Datasets, all }) => {
      const asAlice = await service.login('alice');

      await createDataset(asAlice, 1, 'people');
      await createDataset(asAlice, 1, 'households');
      await deleteDatasets(asAlice, ['people', 'households'], 1);

      // Should not purge anything
      const purgeCount = await Datasets.purge();
      purgeCount.should.equal(0);

      // Recently deleted datasets are not purged
      await all(sql`select name from datasets`)
        .then(remainingDatasets => remainingDatasets.map(d => d.name).should.containDeep(['people', 'households']));
    }));
  });

  describe('deep cleanup of all dataset artifacts', () => {
    it('should purge dataset created by API and all properties', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'people', ['first_name', 'age']);
      await createEntities(asAlice, 2, 1, 'people', ['first_name', 'age']);
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      const purgedCount = await Datasets.purge(true);
      purgedCount.should.be.eql(1);

      // No datasets or properties should remain
      await oneFirst(sql`select count(*) from datasets`)
        .then(count => count.should.equal(0));

      await oneFirst(sql`select count(*) from ds_properties`)
        .then(count => count.should.equal(0));
    }));

    it('should purge all entities from dataset created by API', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'people');
      await createEntities(asAlice, 2, 1, 'people');
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      const purgedCount = await Datasets.purge(true);
      purgedCount.should.be.eql(1);

      // No entities, entity defs, or entity def sources should remain
      await oneFirst(sql`select count(*) from entities`)
        .then(count => count.should.equal(0));

      await oneFirst(sql`select count(*) from entity_defs`)
        .then(count => count.should.equal(0));

      await oneFirst(sql`select count(*) from entity_def_sources`)
        .then(count => count.should.equal(0));
    }));

    it('should purge entities including deleted ones when purging dataset', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'people');
      const uuids = await createEntities(asAlice, 2, 1, 'people');
      await deleteEntities(asAlice, uuids, 1, 'people');

      // create another set of entities to not delete
      await createEntities(asAlice, 3, 1, 'people');

      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      const purgedCount = await Datasets.purge(true);
      purgedCount.should.be.eql(1);

      // No entities, entity defs, or entity def sources should remain
      await oneFirst(sql`select count(*) from entities`)
        .then(count => count.should.equal(0));

      // 5 entities (2 deleted + 3 non-deleted) entities should have been purged
      await oneFirst(sql`select count(*) from purged_entities`)
        .then(count => count.should.equal(5));
    }));

    it('should purge dataset created by a form that writes to it', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');
      await createDatasetFromForm(asAlice, 1);
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the Dataset
      const purgedCount = await Datasets.purge(true);
      purgedCount.should.be.eql(1);

      // No links between dataset and forms should remain
      await oneFirst(sql`select count(*) from ds_property_fields`)
        .then(count => count.should.equal(0));

      await oneFirst(sql`select count(*) from dataset_form_defs`)
        .then(count => count.should.equal(0));
    }));

    it('should purge dataset and all entities created by a form that writes to it', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const { Datasets, oneFirst } = container;
      await createDatasetFromForm(asAlice, 1);

      // Create a submission
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Delete the dataset
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      const purgedCount = await Datasets.purge(true);
      purgedCount.should.be.eql(1);

      // No entities should remain
      await oneFirst(sql`select count(*) from entities`)
        .then(count => count.should.equal(0));

      await oneFirst(sql`select count(*) from entity_defs`)
        .then(count => count.should.equal(0));

      await oneFirst(sql`select count(*) from entity_def_sources`)
        .then(count => count.should.equal(0));

      // Sending another submission does not create any entities
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // No entities created
      await oneFirst(sql`select count(*) from entities`)
        .then(count => count.should.equal(0));

      // Check the audit log for that submission:
      // does not even generate entity.error because form is no longer linked to dataset,
      // even in older versions of the form
      await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/two/audits')
        .expect(200)
        .then(({ body }) => body[0].action.should.equal('submission.create'));
    }));

    it('should purge dataset consumed by a form', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'goodone');

      // Publish form with attachment "goodone.csv"
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Make draft of form
      await asAlice.post('/v1/projects/1/forms/withAttachments/draft')
        .expect(200);

      // Unlink dataset attachment by overwriting with csv
      await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
        .send('test,csv\n1,2')
        .set('Content-Type', 'text/csv')
        .expect(200);

      // Publish draft
      await asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish?version=2')
        .expect(200);

      await deleteDatasets(asAlice, ['goodone'], 1);

      // Purge the dataset
      const purgedCount = await Datasets.purge(true);
      purgedCount.should.be.eql(1);

      // No links between dataset and forms should remain
      await oneFirst(sql`select count(*) from form_attachments where "datasetId" is not null`)
        .then(count => count.should.equal(0));
    }));

    it('should set dataset tombstone in actees table', testService(async (service, { Datasets, one }) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'people');
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      await Datasets.purge(true);

      // Actee for dataset should be in tombstone form
      await one(sql`select * from actees where species = 'dataset' limit 1`)
        .then(row => {
          row.purgedName.should.equal('people');
          row.purgedAt.should.be.a.recentDate();
          row.details.name.should.equal('people');
          row.details.projectId.should.equal(1);
        });
    }));

    it('should set create entity tombstones for those in purged dataset', testService(async (service, { Datasets, all }) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'people');
      const peopleUuids = await createEntities(asAlice, 2, 1, 'people');
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      await Datasets.purge(true);

      // Entity uuids should be captured
      const purgedEntities = await all(sql`SELECT "entityUuid" FROM purged_entities`).then(map(e => e.entityUuid));
      purgedEntities.should.containDeep(peopleUuids);
    }));

    it('should redact notes of a deleted entity sent with x-action-notes', testService(async (service, { Datasets, oneFirst }) => {
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

      // Delete the dataset
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      await Datasets.purge(true);

      // Look at what is in the audit log via the database because the entity is deleted
      const auditNotes = await oneFirst(sql`select notes from audits where action = 'entity.create'`);

      // Check that the note is redacted
      should(auditNotes).be.null();
    }));

    it('should create audit log entry for purging a dataset', testService(async (service, { Datasets, oneFirst }) => {
      const asAlice = await service.login('alice');
      await createDataset(asAlice, 1, 'people');
      await createDataset(asAlice, 1, 'trees');
      await deleteDatasets(asAlice, ['people', 'trees'], 1);

      const peopleActeeId = await oneFirst(sql`SELECT "acteeId" FROM datasets WHERE name = 'people'`);
      const treesActeeId = await oneFirst(sql`SELECT "acteeId" FROM datasets WHERE name = 'trees'`);

      // Purge the dataset
      await Datasets.purge(true);

      await asAlice.get('/v1/audits')
        .then(({ body }) => {
          const purgeLogs = body.filter((a) => a.action === 'dataset.purge');
          purgeLogs.length.should.equal(2);

          const [ peoplePurgeAudit ] = purgeLogs.filter(a => a.acteeId === peopleActeeId);
          peoplePurgeAudit.details.name.should.equal('people');

          const [ treesPurgeAudit ] = purgeLogs.filter(a => a.acteeId === treesActeeId);
          treesPurgeAudit.details.name.should.equal('trees');
        });
    }));

    it('should remove things from submission backlog', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const { Datasets, oneFirst } = container;

      // Publish a form that will set up the dataset with properties
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.offlineEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('trunkVersion="1"', `trunkVersion="3"`)
          .replace('baseVersion="1"', `baseVersion="3"`)
          .replace('branchId=""', `branchId="${uuid()}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Create another form with another dataset that also puts something in the backlog
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.offlineEntity
          .replace('id="offlineEntity"', 'id="offlineEntity2"')
          .replace('dataset="people"', 'dataset="patients"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity2/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="offlineEntity"', 'id="offlineEntity2"')
          .replace('dataset="people"', 'dataset="patients"')
          .replace('trunkVersion="1"', `trunkVersion="3"`)
          .replace('baseVersion="1"', `baseVersion="3"`)
          .replace('branchId=""', `branchId="${uuid()}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await oneFirst(sql`select count(*) from entity_submission_backlog`)
        .then(count => count.should.equal(2));

      // unlink dataset from form
      const formWithoutEntity = testData.forms.offlineEntity
        .replace('orx:version="1.0"', 'orx:version="2.0"')
        .replace(/<meta>[\s\S]*?<\/meta>/g, '')
        .replace(/entities:saveto=".*"/g, '');

      await asAlice.post('/v1/projects/1/forms/offlineEntity/draft?ignoreWarnings=true')
        .send(formWithoutEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/draft/publish')
        .expect(200);

      // delete dataset
      await deleteDatasets(asAlice, ['people'], 1);

      // Purge the dataset
      await Datasets.purge(true);

      // Submission for non-deleted dataset should still exist
      await oneFirst(sql`select count(*) from entity_submission_backlog`)
        .then(count => count.should.equal(1));
    }));
  });
});
