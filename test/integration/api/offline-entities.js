const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { getOrNotFound } = require('../../../lib/util/promise');
const uuid = require('uuid').v4;
const should = require('should');

const { exhaust } = require(appRoot + '/lib/worker/worker');

const testOfflineEntities = (test) => testService(async (service, container) => {
  const asAlice = await service.login('alice');

  // Publish a form that will set up the dataset with properties
  await asAlice.post('/v1/projects/1/forms?publish=true')
    .send(testData.forms.offlineEntity)
    .set('Content-Type', 'application/xml')
    .expect(200);

  // Create an entity via the API (to be updated offline)
  await asAlice.post('/v1/projects/1/datasets/people/entities')
    .send({
      uuid: '12345678-1234-4123-8234-123456789abc',
      label: 'Johnny Doe',
      data: { first_name: 'Johnny', age: '22' }
    })
    .expect(200);

  await exhaust(container);

  await test(service, container);
});

describe('Offline Entities', () => {
  describe('parsing runId and runIndex from submission xml', () => {
    it('should parse and save run info from sub creating an entity', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const runId = uuid();
      const dataset = await container.Datasets.get(1, 'people', true).then(getOrNotFound);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('runId=""', `runId="${runId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const entity = await container.Entities.getById(dataset.id, '12345678-1234-4123-8234-123456789ddd').then(getOrNotFound);
      entity.aux.currentVersion.runId.should.equal(runId);
      entity.aux.currentVersion.runIndex.should.equal(1);
      entity.aux.currentVersion.data.should.eql({ age: '20', status: 'new', first_name: 'Megan' });
    }));

    it('should parse and save run info from sub updating an entity', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const runId = uuid();
      const dataset = await container.Datasets.get(1, 'people', true).then(getOrNotFound);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const entity = await container.Entities.getById(dataset.id, '12345678-1234-4123-8234-123456789abc').then(getOrNotFound);
      entity.aux.currentVersion.runId.should.equal(runId);
      entity.aux.currentVersion.runIndex.should.equal(1);
      entity.aux.currentVersion.data.should.eql({ age: '22', status: 'arrived', first_name: 'Johnny' });
    }));

    it('should quietly process submission without entity work if run index is not good', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${uuid()}"`)
          .replace('runIndex="1"', 'runIndex="2"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          // no status in data because out of order update did not get applied
          body.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
        });

      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one/audits')
        .expect(200)
        .then(({ body }) => {
          should.not.exist(body[0].details.problem);
        });
    }));
  });

  describe('out of order runs', () => {

    it('should let multiple updates in the same run get applied in order', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const runId = uuid();
      const dataset = await container.Datasets.get(1, 'people', true).then(getOrNotFound);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
          .replace('one', 'one-update')
          .replace('runIndex="1"', 'runIndex="2"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const entity = await container.Entities.getById(dataset.id, '12345678-1234-4123-8234-123456789abc').then(getOrNotFound);
      entity.aux.currentVersion.runId.should.equal(runId);
      entity.aux.currentVersion.runIndex.should.equal(2);
      entity.aux.currentVersion.data.should.eql({ age: '22', status: 'departed', first_name: 'Johnny' });
    }));

    it('should not apply out of order update from a run after starting a run', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const runId = uuid();
      const dataset = await container.Datasets.get(1, 'people', true).then(getOrNotFound);

      // start run correctly
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // much later run index
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
          .replace('one', 'one-update2')
          .replace('runIndex="1"', 'runIndex="3"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const entity = await container.Entities.getById(dataset.id, '12345678-1234-4123-8234-123456789abc').then(getOrNotFound);
      entity.aux.currentVersion.runId.should.equal(runId);
      entity.aux.currentVersion.runIndex.should.equal(1);
      entity.aux.currentVersion.data.should.eql({ age: '22', status: 'arrived', first_name: 'Johnny' });
    }));

    it('should not apply later runIndex when run has not even started', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const runId = uuid();
      const dataset = await container.Datasets.get(1, 'people', true).then(getOrNotFound);

      // much later run index
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
          .replace('one', 'one-update2')
          .replace('runIndex="1"', 'runIndex="2"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const entity = await container.Entities.getById(dataset.id, '12345678-1234-4123-8234-123456789abc').then(getOrNotFound);
      should.not.exist(entity.aux.currentVersion.runId);
      should.not.exist(entity.aux.currentVersion.runIndex);
      entity.aux.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
    }));

    it('should apply later run received earlier', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const runId = uuid();
      const dataset = await container.Datasets.get(1, 'people', true).then(getOrNotFound);

      // start run correctly
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`) // runIndex = 1
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
          .replace('one', 'one-update2')
          .replace('runIndex="1"', 'runIndex="3"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('runId=""', `runId="${runId}"`)
          .replace('one', 'one-update1')
          .replace('runIndex="1"', 'runIndex="2"')
          .replace('<status>arrived</status>', '<status>working</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const entity = await container.Entities.getById(dataset.id, '12345678-1234-4123-8234-123456789abc').then(getOrNotFound);
      entity.aux.currentVersion.runId.should.equal(runId);
      entity.aux.currentVersion.runIndex.should.equal(3);
      entity.aux.currentVersion.data.should.eql({ age: '22', status: 'departed', first_name: 'Johnny' });
    }));
  });
});
