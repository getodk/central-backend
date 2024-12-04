const appRoot = require('app-root-path');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const uuid = require('uuid').v4;
const should = require('should');
const { sql } = require('slonik');

const { exhaust, exhaustParallel } = require(appRoot + '/lib/worker/worker');

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
  describe('parsing branchId and trunkVersion from submission xml', () => {
    it('should parse and save info from submission creating an entity', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // create=1 is specified, but baseVersion, trunkVersion, and branchId are all empty for entity creation
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .then(({ body }) => {
          body.currentVersion.data.should.eql({ age: '20', status: 'new', first_name: 'Megan' });
          body.currentVersion.version.should.equal(1);

          // This is the first version of the entity so there should be no base or trunk versions
          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.baseVersion);
          should.not.exist(body.currentVersion.branchBaseVersion);
          // There is also no branchId because Collect does not send one for entity creation
          should.not.exist(body.currentVersion.branchId);
        });
    }));

    it('should parse and save branch info from sub updating an entity', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.data.should.eql({ age: '22', status: 'arrived', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(1);
          body.currentVersion.trunkVersion.should.equal(1);
        });
    }));

    it('should ignore empty string trunkVersion and branchId values in update scenario', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // branchId = "" and trunkVersion = ""
      // apply update as though it were not offline case
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('trunkVersion="1"', `trunkVersion=""`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.data.should.eql({ age: '22', status: 'arrived', first_name: 'Johnny' });

          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.branchBaseVersion);
          should.not.exist(body.currentVersion.branchId);
        });
    }));

    it('should log processing error if trunkVersion is set but branchId is not', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // branchId = "" but trunkVersion = "1" (will cause entity processing error)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // hasn't been updated
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          should.not.exist(body.currentVersion.baseVersion);
          body.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });

          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.branchBaseVersion);
          should.not.exist(body.currentVersion.branchId);
        });

      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one/audits')
        .expect(200)
        .then(({ body }) => {
          body[0].details.errorMessage.should.eql('Required parameter branchId missing.');
        });
    }));
  });

  describe('offline branches submitted in order', () => {
    it('should let multiple updates in the same branch get applied in order', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(3);
          body.currentVersion.baseVersion.should.equal(2);
          body.currentVersion.data.should.eql({ age: '22', status: 'departed', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(2);
          body.currentVersion.trunkVersion.should.equal(1);
        });
    }));

    it('should apply update branch in order after server version has advanced', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
        .send({ label: 'Johnny Doe (age 22)' })
        .expect(200);

      // the trunk version of these submissions is 1, but the server version has advanced beyond that
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(4);
          body.currentVersion.baseVersion.should.equal(3);
          body.currentVersion.data.should.eql({ age: '22', status: 'departed', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(2);
          body.currentVersion.trunkVersion.should.equal(1);
        });
    }));

    it('should handle updating a branch in order, but with an interruption', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Update entity on the server (interrupt at beginning, too)
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
        .send({ label: 'Johnny - changed label' })
        .expect(200);

      // Submit the first update in the branch
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Apply the update from the submission
      await exhaust(container);

      // Update entity on the server (server version is now 3)
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=3')
        .send({ label: 'Johnny Doe (age 22)' })
        .expect(200);

      // Submit second update in branch
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(5);
          body.currentVersion.baseVersion.should.equal(3);
          body.currentVersion.data.should.eql({ age: '22', status: 'departed', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(2);
          body.currentVersion.trunkVersion.should.equal(1);
        });
    }));

    it('should handle an offline branch that starts with a create', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // First submission creates the entity, offline version is now 1
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Second submission updates the entity
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.data.should.eql({ age: '20', status: 'checked in', first_name: 'Megan' });

          body.currentVersion.branchId.should.equal(branchId);
          should.not.exist(body.currentVersion.trunkVersion);
          body.currentVersion.branchBaseVersion.should.equal(1);
        });
    }));

    it('should handle offline create+update+update with interleaved online updates', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // First submission creates the entity
      // no trunk version
      // sets name, age, status
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Update the entity online
      // Change age
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd?baseVersion=1')
        .send({ data: { age: '30' } });

      // Second submission (1st offline update after offline create)
      // updates the status only
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>arrived</status>')
          .replace('<name>Megan</name>', '')
          .replace('<age>20</age>', '')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Update the entity online
      // change age again
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd?baseVersion=3')
        .send({ data: { age: '40' } });

      // Third submission (2nd offline update)
      // updates the status only
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update2')
          .replace('baseVersion=""', 'baseVersion="2"')
          .replace('<status>new</status>', '<status>complete</status>')
          .replace('<name>Megan</name>', '')
          .replace('<age>20</age>', '')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Check that the actual computed base version is the right one (v3) while branchBaseVersion is v2.
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(5);
          body.currentVersion.baseVersion.should.equal(3);
          body.currentVersion.data.should.eql({ age: '40', status: 'complete', first_name: 'Megan' });

          body.currentVersion.branchId.should.equal(branchId);
          should.not.exist(body.currentVersion.trunkVersion);
          body.currentVersion.branchBaseVersion.should.equal(2);
        });
    }));
  });

  describe('out of order runs', () => {
    it('should quietly process submission without entity work if trunk and base versions are not good', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // trunk version is 1, but base version is higher than trunk version indicating it is later in the run
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${uuid()}"`)
          .replace('baseVersion="1"', 'baseVersion="2"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          // no status property in data because out of order update did not get applied
          body.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });
        });

      // Processing this should not yeild an error even if update doesnt get applied
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one/audits')
        .expect(200)
        .then(({ body }) => {
          should.not.exist(body[0].details.problem);
        });

      // This submission is now held in the backlog, but that functionality is checked in later tests
    }));

    it('should not apply out of order update from a run after starting a run', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // start run correctly
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // much later run index
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="3"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.data.should.eql({ age: '22', status: 'arrived', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(1);
          body.currentVersion.trunkVersion.should.equal(1);
        });
    }));

    it('should not apply later trunkVersion (past existing server version)', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // trunkVersion past existing server version
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('trunkVersion="1"', 'trunkVersion="2"')
          .replace('<status>arrived</status>', '<status>weird case</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);

      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one/audits')
        .expect(200)
        .then(({ body }) => {
          body[0].details.errorMessage.should.eql('Base version (trunkVersion=2) does not exist for entity UUID (12345678-1234-4123-8234-123456789abc) in dataset (people).');
        });


      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          should.not.exist(body.currentVersion.baseVersion);
          body.currentVersion.data.should.eql({ age: '22', first_name: 'Johnny' });


          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.branchBaseVersion);
          should.not.exist(body.currentVersion.branchId);
        });
    }));

    it('should apply later run received earlier', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // start run correctly
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // have two updates within the run
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="3"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

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

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(4);
          body.currentVersion.baseVersion.should.equal(3);
          body.currentVersion.data.should.eql({ age: '22', status: 'departed', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(3);
          body.currentVersion.trunkVersion.should.equal(1);
        });
    }));

    it('should handle offline update that comes before a create', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Send the second submission that updates an entity (before the entity has been created)
      // This submission has a branchId
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      // Send the second submission to create the entity
      // This submission does not have an explicit branchId, but it should trigger
      // the processing of the next submission in the branch.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.data.should.eql({ age: '20', status: 'checked in', first_name: 'Megan' });

          body.currentVersion.branchId.should.equal(branchId);
          should.not.exist(body.currentVersion.trunkVersion);
          body.currentVersion.branchBaseVersion.should.equal(1);
        });
    }));

    it('should handle offline create/update that comes in backwards', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // First submission contains the last update
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update2')
          .replace('baseVersion=""', 'baseVersion="2"')
          .replace('<status>new</status>', '<status>working</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      // Second submission contains update after create (middle of branch)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(2);

      // Third (but logically first) submission to create entity
      // which does not have an explicit branchId.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(3);
          body.currentVersion.baseVersion.should.equal(2);
          body.currentVersion.data.should.eql({ age: '20', status: 'working', first_name: 'Megan' });

          body.currentVersion.branchId.should.equal(branchId);
          should.not.exist(body.currentVersion.trunkVersion);
          body.currentVersion.branchBaseVersion.should.equal(2);
        });
    }));

    it('should not include submission.reprocess event in audit log of held submission', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
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

      // Send first update in
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one-update1/audits')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(2);
          body.map(a => a.action).should.eql([
            'entity.update.version',
            'submission.create'
          ]);
        });
    }));
  });

  describe('reprocessing submissions when toggling approvalRequired dataset flag', () => {
    it('should not over-process a submission that is being held because it is later in a run', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Configure the entity list to create entities on submission approval
      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      // This submission updates an existing entity.
      // Trunk version is 1, but base version is higher than trunk version indicating it is later in the branch.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('baseVersion="1"', 'baseVersion="2"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Observe that there is one held submission.
      let count = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      count.should.equal(1);

      // Observe that the submission was initially processed without error
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one/audits')
        .expect(200)
        .then(({ body }) => {
          should.not.exist(body[0].details.problem);
        });

      // Observe this update was not applied (there is no second version) because earlier update in branch is missing.
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .then(({ body: versions }) => {
          versions.length.should.equal(1);
        });

      // Trigger the submission reprocessing by updating the entity list settings
      await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
        .send({ approvalRequired: false })
        .expect(200);

      await exhaust(container);

      // Observe that there is still just one held submission.
      count = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      count.should.equal(1);

      // Observe that the submission still has no processing errors
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one/audits')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          should.not.exist(body[0].details.problem);
        });

      // Observe that the update was still not applied.
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .then(({ body: versions }) => {
          versions.length.should.equal(1);
        });

      // Send in missing submission from earlier in the branch.
      // Trunk version is 1, base version is 1
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update')
          .replace('<status>arrived</status>', '<status>waiting</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Observe that both updates have now been applied.
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .then(({ body: versions }) => {
          versions.length.should.equal(3);
        });

      // Observe that there are no longer any held submissions.
      count = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      count.should.equal(0);
    }));

    it('should wait for approval of create submission in offline branch', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      // Configure the entity list to create entities on submission approval
      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      const branchId = uuid();

      // First submission creates the entity, offline version is now 1
      // But this submission requires approval so it wont get processed at first
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Second submission updates the entity
      // but it should be waiting for first version to come through
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Entity should not exist yet
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(404);

      // Neither submission should have a processing error
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/two/audits')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          should.not.exist(body[0].details.problem);
        });
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/two-update/audits')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          should.not.exist(body[0].details.problem);
        });

      // There should be one submission (the second one) in the held submissions queue
      let count = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      count.should.equal(1);

      // Approving the first submission should start a chain that includes the second submission
      await asAlice.patch('/v1/projects/1/forms/offlineEntity/submissions/two')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.data.should.eql({ age: '20', status: 'checked in', first_name: 'Megan' });

          body.currentVersion.branchId.should.equal(branchId);
          should.not.exist(body.currentVersion.trunkVersion);
          body.currentVersion.branchBaseVersion.should.equal(1);
        });

      // Now there should be no submissions in the backlog.
      count = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      count.should.equal(0);
    }));

    it('should not process update submission in backlog if approvalRequired is true', testOfflineEntities(async (service, container) => {
      // Demonstrating issue c#811
      const asAlice = await service.login('alice');

      // Configure the entity list to create entities on submission approval
      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      const branchId = uuid();

      // Send update submission (imagine that registration submission is lost)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // There should be one item in the backlog
      let count = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      count.should.equal(1);

      // Force process backlog
      await container.Entities.processBacklog(true);

      // There should be nothing in the backlog
      count = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      count.should.equal(0);

      // Entity should not exist
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(404);

      // Submission should not have a processing error, just the create event.
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/two-update/audits')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          body[0].action.should.eql('submission.create');
          should.not.exist(body[0].details.problem);
        });
    }));
  });

  describe('force-processing held submissions', () => {
    it('should apply an entity update when the previous update is missing', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Trunk version is 1, but base version is 2
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('baseVersion="1"', 'baseVersion="2"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      await container.Entities.processBacklog(true);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.data.should.eql({ age: '22', status: 'arrived', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.trunkVersion.should.equal(1);
          body.currentVersion.branchBaseVersion.should.equal(2);
        });

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);
    }));

    it('should apply two updates when first upate is missing', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Trunk version is 1, but base version is 2
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('baseVersion="1"', 'baseVersion="2"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="3"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(2);

      await container.Entities.processBacklog(true);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(3);
          body.currentVersion.baseVersion.should.equal(2);
          body.currentVersion.data.should.eql({ age: '22', status: 'departed', first_name: 'Johnny' });

          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.trunkVersion.should.equal(1);
          body.currentVersion.branchBaseVersion.should.equal(3);
        });

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);
    }));

    it('should apply an entity update as a create', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();
      const newUuid = uuid();

      // Base version is 1 but it doesnt exist
      // trunk version doesnt make sense to exist here either
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc"', `id="${newUuid}"`)
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('trunkVersion="1"', 'trunkVersion=""')
          .replace('baseVersion="1"', 'baseVersion="2"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('branchId=""', `branchId="${uuid()}"`)
          .replace('create="1"', 'update="1"')
          .replace('<label>Megan (20)</label>', '<label></label>')
          .replace('baseVersion=""', 'baseVersion="2"')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(2);

      await container.Entities.processBacklog(true);

      await asAlice.get(`/v1/projects/1/datasets/people/entities/${newUuid}`)
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          body.currentVersion.data.should.eql({ status: 'arrived' });
          body.currentVersion.label.should.eql('auto generated');
          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(2);

          // This is the first version of the entity so there should be no base or trunk versions
          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.baseVersion);
        });


      await asAlice.get(`/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd`)
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          body.currentVersion.data.should.eql({ status: 'new', first_name: 'Megan', age: '20' });
          body.currentVersion.label.should.eql('auto generated');
          body.currentVersion.branchId.should.be.a.uuid();
          body.currentVersion.branchBaseVersion.should.equal(2);

          // This is the first version of the entity so there should be no base or trunk versions
          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.baseVersion);
        });

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);
    }));

    it('should apply an entity update as a create followed by another update', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();
      const newUuid = uuid();

      // Base version is 1 but it doesnt exist
      // trunk version doesnt make sense to exist here either
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc"', `id="${newUuid}"`)
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('trunkVersion="1"', 'trunkVersion=""')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // base version is 2 now
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update')
          .replace('id="12345678-1234-4123-8234-123456789abc"', `id="${newUuid}"`)
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('trunkVersion="1"', 'trunkVersion=""')
          .replace('<status>arrived</status>', '<name>Dana</name><status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(2);

      await container.Entities.processBacklog(true);

      await asAlice.get(`/v1/projects/1/datasets/people/entities/${newUuid}`)
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.data.should.eql({ status: 'checked in', first_name: 'Dana' });
          body.currentVersion.label.should.eql('auto generated');
          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.baseVersion.should.equal(1);
          body.currentVersion.branchBaseVersion.should.equal(2);
          should.not.exist(body.currentVersion.trunkVersion);
        });

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);

      // send in another update much later in the same branch
      // base version is 10 now (many missing intermediate updates)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update10')
          .replace('id="12345678-1234-4123-8234-123456789abc"', `id="${newUuid}"`)
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('baseVersion="1"', 'baseVersion="10"')
          .replace('trunkVersion="1"', 'trunkVersion=""')
          .replace('<status>arrived</status>', '<name>Dana</name><status>registered</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      await container.Entities.processBacklog(true);

      await asAlice.get(`/v1/projects/1/datasets/people/entities/${newUuid}`)
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(3);
          body.currentVersion.data.should.eql({ status: 'registered', first_name: 'Dana' });
          body.currentVersion.label.should.eql('auto generated');
          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.baseVersion.should.equal(2);
          body.currentVersion.branchBaseVersion.should.equal(10);
          should.not.exist(body.currentVersion.trunkVersion);
        });

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);
    }));

    it('should apply an entity update as a create, and then properly handle the delayed create as an update', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Send first submission, which is an update that will be applied as a create
      // Removing extra fields of the submission to demonstrate a simpler update with missing fields
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
          .replace('<label>Megan (20)</label>', '')
          .replace('<age>20</age>', '')
          .replace('<name>Megan</name>', '')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      // Force the update submission to be processed as a create
      await container.Entities.processBacklog(true);

      await asAlice.get(`/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd`)
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          body.currentVersion.data.should.eql({ status: 'checked in' });
          body.currentVersion.label.should.eql('auto generated');
          body.currentVersion.branchId.should.equal(branchId);
          body.currentVersion.branchBaseVersion.should.equal(1);
          should.not.exist(body.currentVersion.baseVersion);
          should.not.exist(body.currentVersion.trunkVersion);
          should(body.conflict).equal(null); // conflict should be null after update-as-create
        });

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);

      // First submission creates the entity, but this will be processed as an update
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get(`/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd`)
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(2);
          body.currentVersion.data.should.eql({ age: '20', status: 'new', first_name: 'Megan' });
          body.conflict.should.equal('soft'); // this should be marked as a soft conflict
          body.currentVersion.baseVersion.should.equal(1); // baseVersion is set, but normally the baseVersion of an entity-create is null
          // the rest of these are null like a normal entity-create
          should.not.exist(body.currentVersion.branchBaseVersion);
          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.branchId);
        });
    }));

    it('should verify that the create-as-update submission was parsed as a create even when applied as an update', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Send first submission, which is an update that will be applied as a create
      // Removing extra fields of the submission to demonstrate a simpler update with missing fields
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
          .replace('<label>Megan (20)</label>', '')
          .replace('<age>20</age>', '')
          .replace('<name>Megan</name>', '')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
      await container.Entities.processBacklog(true);

      // First submission creates the entity, but it should trigger an entity-processing error
      // because there is no label
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('<label>Megan (20)</label>', '')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get(`/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd`)
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
        });

      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/two/audits')
        .expect(200)
        .then(({ body }) => {
          body[0].action.should.equal('entity.error');
          body[0].details.errorMessage.should.eql('Required parameter label missing.');
        });
    }));

    describe('only force-process submissions held in backlog for a certain amount of time', () => {
      it('should process a submission from over 7 days ago', testOfflineEntities(async (service, container) => {
        const asAlice = await service.login('alice');
        const branchId = uuid();

        // Neither update below will be applied at first because the first
        // update in the branch is missing.

        // Send the first submission, which will be held in the backlog
        await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
          .send(testData.instances.offlineEntity.one
            .replace('branchId=""', `branchId="${branchId}"`)
            .replace('baseVersion="1"', 'baseVersion="2"')
          )
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // One submission should be in the backlog
        let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(1);

        // Update the timestamp on this to in the past, but less than the default hold duration
        await container.run(sql`UPDATE entity_submission_backlog SET "loggedAt" = "loggedAt" - interval '4 days'`);

        // The submission should not have been processed
        let count = await container.Entities.processBacklog();
        count.should.equal(0);

        // The submission should still be held in the backlog
        backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(1);

        // Update the timestamp on this backlog
        await container.run(sql`UPDATE entity_submission_backlog SET "loggedAt" = "loggedAt" - interval '6 days'`);

        // Send the next submission, which will also be held in the backlog.
        // This submission immediately follows the previous one, but force-processing
        // the first submission does not cause this one to be processed.
        await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
          .send(testData.instances.offlineEntity.one
            .replace('branchId=""', `branchId="${branchId}"`)
            .replace('one', 'one-update')
            .replace('baseVersion="1"', 'baseVersion="3"')
            .replace('<status>arrived</status>', '<status>departed</status>')
          )
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // Both submissions should be in the backlog now
        backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(2);

        // Process submissions that have been in the backlog for a long time
        // (only 1 of 2 should be processed)
        count = await container.Entities.processBacklog();
        count.should.equal(1);

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body }) => {
            body.currentVersion.version.should.equal(2);
            body.currentVersion.baseVersion.should.equal(1);
            body.currentVersion.data.should.eql({ age: '22', status: 'arrived', first_name: 'Johnny' });

            body.currentVersion.branchId.should.equal(branchId);
            body.currentVersion.trunkVersion.should.equal(1);
            body.currentVersion.branchBaseVersion.should.equal(2);
          });

        // One submission should still be in the backlog
        backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(1);
      }));
    });

    describe('force-processing deleted submissions and entities', () => {
      it('should not process a submission in a soft-deleted form', testOfflineEntities(async (service, container) => {
        const asAlice = await service.login('alice');
        const branchId = uuid();

        // Send the first submission, which will be held in the backlog because the base version is high
        await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
          .send(testData.instances.offlineEntity.one
            .replace('branchId=""', `branchId="${branchId}"`)
            .replace('baseVersion="1"', 'baseVersion="2"')
          )
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(1);

        // Soft-delete the form to delete the submission
        await asAlice.delete('/v1/projects/1/forms/offlineEntity');

        // Process the backlog (count will be 1 but update should not be applied to entity)
        const processedCount = await container.Entities.processBacklog(true);
        processedCount.should.equal(1);

        // Check that the entity is still at version 1
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body }) => {
            body.currentVersion.version.should.equal(1);
          });
      }));

      it('should not process a submission that has been soft-deleted', testOfflineEntities(async (service, container) => {
        const asAlice = await service.login('alice');
        const branchId = uuid();

        // Send the first submission, which will be held in the backlog because the base version is high
        await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
          .send(testData.instances.offlineEntity.one
            .replace('branchId=""', `branchId="${branchId}"`)
            .replace('baseVersion="1"', 'baseVersion="2"')
          )
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(1);

        // Soft-delete the submission via the database
        await container.run(sql`UPDATE submissions SET "deletedAt" = NOW() WHERE "instanceId" = 'one'`);

        // Process the backlog (count will be 1 but update should not be applied to entity)
        const processedCount = await container.Entities.processBacklog(true);
        processedCount.should.equal(1);

        // Check that the entity is still at version 1
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body }) => {
            body.currentVersion.version.should.equal(1);
          });
      }));

      it('should not process a submission for an entity that has been soft-deleted', testOfflineEntities(async (service, container) => {
        const asAlice = await service.login('alice');
        const branchId = uuid();

        // Send the first submission, which will be held in the backlog because the base version is high
        await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
          .send(testData.instances.offlineEntity.one
            .replace('branchId=""', `branchId="${branchId}"`)
            .replace('baseVersion="1"', 'baseVersion="2"')
          )
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(1);

        // Soft-delete the entity
        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc');

        // Process the backlog (count will be 1 but update should not be applied to entity)
        const processedCount = await container.Entities.processBacklog(true);
        processedCount.should.equal(1);

        // Check that the backlog count is now 0
        backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        backlogCount.should.equal(0);

        // Check for an entity error on the submission
        await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one/audits')
          .expect(200)
          .then(({ body }) => {
            body[0].details.errorMessage.should.eql('The entity with UUID (12345678-1234-4123-8234-123456789abc) has been deleted.');
          });
      }));
    });
  });

  describe('conflict cases', () => {
    it('should mark an update that is not contiguous with its trunk version as a soft conflict', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Update existing entity on server (change age from 22 to 24)
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
        .send({ data: { age: '24' } })
        .expect(200);

      // Send update (change status from null to arrived, no other properties included/changed)
      // Introduces a soft conflict because baseVersion is 1
      // But no hard conflict
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Send second update (change age from 22 to 26, instead of changing status)
      // Doesn't conflict with previous version (from the same offline branch)
      // But it should be marked as a soft conflict because the branch was
      // interrupted by the first API update.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('<status>arrived</status>', '<age>26</age>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Final version should have soft conflict
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .then(({ body: versions }) => {
          versions.map(v => v.conflict).should.eql([null, null, 'soft', 'soft']);
        });

      // Overall entity should have soft conflict
      // (A test below shows this is set explicitily and not just carried over
      // from the previous conflict state.)
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .then(({ body: entity }) => {
          should(entity.conflict).equal('soft');
        });
    }));

    it('should mark an update that is not contiguous (due to force processing) as a soft conflict', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Scenario described in issue: c#698
      // Send second update first
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('<status>arrived</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
      await container.Entities.processBacklog(true);

      // Send first update now (it will be applied right away)
      // Introduces a hard conflict because it will find baseVersion v1
      // and the force-processed update above also branched of v1
      // and both update 'status'.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Entity conflict should be hard at this point
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .then(({ body: entity }) => {
          should(entity.conflict).equal('hard');
        });

      // Send fourth update (skipping a 3rd update so this must be force-applied)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update4')
          .replace('baseVersion="1"', 'baseVersion="4"')
          .replace('<status>arrived</status>', '<status>departed</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
      await container.Entities.processBacklog(true);

      // All updates are from the same branch, but 1 expected version is missing
      // and updates came in out of order. Unclear if final 'soft' conflict is what we
      // want or if it should possibly be null.
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .then(({ body: versions }) => {
          versions.map(v => v.conflict).should.eql([null, null, 'hard', 'soft']);
        });

      // Hard conflict is carried forward
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .then(({ body: entity }) => {
          should(entity.conflict).equal('hard');
        });
    }));

    it('should mark an update that is not contiguous with its trunk version as a soft conflict on entity despite earlier conflict resolution', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Update existing entity on server (change age from 22 to 24)
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
        .send({ data: { age: '24' } })
        .expect(200);

      // Send update (change status from null to arrived, don't change age)
      // Has soft conflict with parallel update but doesn't have hard conflict
      // because different properties were changed.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      // Entity has soft conflict at this point
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .then(({ body: entity }) => {
          should(entity.conflict).equal('soft');
        });

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=3')
        .expect(200);

      // Send second update (change age from 22 to 26)
      // Doesn't conflict with previous version (from the same offline branch)
      // But it should be marked as a soft conflict because the branch was
      // interrupted by the first API update.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('<status>arrived</status>', '<age>26</age>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      // Final version conflict is soft because of interrupted branch
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .then(({ body: versions }) => {
          versions.map(v => v.conflict).should.eql([null, null, 'soft', 'soft']);
        });

      // Entity version is soft
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .then(({ body: entity }) => {
          should(entity.conflict).equal('soft');
        });
    }));

    it('should mark an update that is not contiguous (from an offline create branch) as a soft conflict on entity despite earlier conflict resolution', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Send initial submission to create entity
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      // Update existing entity on server before getting the rest of the branch
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd?baseVersion=1')
        .send({ data: { age: '24' } })
        .expect(200);

      // Send update (change status from new to arrived)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('two', 'two-update1')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('create="1"', 'update="1"')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>arrived</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      // Conflict is hard here
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .then(({ body: entity }) => {
          should(entity.conflict).equal('hard');
        });

      // resolve the conflict
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd?resolve=true&baseVersion=3')
        .expect(200);

      // Send second update in offline create-update-update chain (change age from 22 to 26)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('two', 'two-update2')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('create="1"', 'update="1"')
          .replace('baseVersion=""', 'baseVersion="2"')
          .replace('<status>new</status>', '<status>arrived</status>')
          .replace('<age>20</age>', '<age>27</age>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd/versions')
        .then(({ body: versions }) => {
          versions.map(v => v.conflict).should.eql([null, null, 'hard', 'soft']);
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .then(({ body: entity }) => {
          should(entity.conflict).equal('soft');
        });
    }));

    it('should check that interrupting version logic is doesnt flag non-conflicts as conflicts', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Send initial submission to create entity
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      // Send second update in offline create-update-update chain (change age from 22 to 26)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('two', 'two-update')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('create="1"', 'update="1"')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>arrived</status>')
          .replace('<age>20</age>', '<age>27</age>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd/versions')
        .then(({ body: versions }) => {
          versions.map(v => v.conflict).should.eql([null, null]);
        });

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .then(({ body: entity }) => {
          should(entity.conflict).equal(null);
        });
    }));
  });

  describe('locking an entity while processing a related submission', function() {
    this.timeout(8000);

    // https://github.com/getodk/central/issues/705
    it('should concurrently process an offline create + update @slow', testServiceFullTrx(async (service, container) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.offlineEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      // Set up the race condition.
      const race = async () => {
        const entityUuid = uuid();
        await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
          .send(testData.instances.offlineEntity.two
            .replace('two', uuid())
            .replace('12345678-1234-4123-8234-123456789ddd', entityUuid))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
          .send(testData.instances.offlineEntity.two
            .replace('two', uuid())
            .replace('12345678-1234-4123-8234-123456789ddd', entityUuid)
            .replace('create="1"', 'update="1"')
            .replace('branchId=""', `branchId="${uuid()}"`)
            .replace('baseVersion=""', 'baseVersion="1"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaustParallel(container);

        const { body: entity } = await asAlice.get(`/v1/projects/1/datasets/people/entities/${entityUuid}`)
          .expect(200);
        const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
        return entity.currentVersion.version === 2 && backlogCount === 0;
      };
      // Run the race condition 50 times. If I remove locking in
      // Entities._processSubmissionEvent(), then successCount < 10. With
      // locking in place, successCount === 50. It's because it's often the case
      // that successCount > 0 even without locking that we run the race
      // condition multiple times.
      let successCount = 0;
      for (let i = 0; i < 50; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (await race()) successCount += 1;
      }
      successCount.should.equal(50);
    }));
  });

  describe('miscellaneous', () => {
    it.only('should handle two updates followed by delayed create', testOfflineEntities(async (service, container) => {
      // Issue c#808
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Send second update first
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update2')
          .replace('baseVersion=""', 'baseVersion="2"')
          .replace('<status>checked in</status>', '<status>working</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Send first update second
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update1')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Check backlog
      const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(2);

      await container.Entities.processBacklog(true);

      // Send registration
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Check submission audit log
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/two/audits')
        .expect(200)
        .then(({ body }) => {
          // TODO it should update the entity, not have this creation error
          body[0].details.errorMessage.should.equal('Query returns an unexpected result.');
        });
    }));

    it.only('should handle update from sub and update from API followed by delayed create', testOfflineEntities(async (service, container) => {
      // Issue c#810
      const asAlice = await service.login('alice');
      const branchId = uuid();

      // Send first update
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update1')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Check backlog
      const backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      await container.Entities.processBacklog(true);

      // Update entity via API
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd?baseVersion=1')
        .send({ data: { age: '24' } })
        .expect(200);

      // Send registration
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Check submission audit log
      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/two/audits')
        .expect(200)
        .then(({ body }) => {
          // TODO it should update the entity, not have this creation error
          body[0].details.errorMessage.should.equal('Query returns an unexpected result.');
        });
    }));
  });
});
