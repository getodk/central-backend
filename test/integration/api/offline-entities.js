const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const uuid = require('uuid').v4;
const should = require('should');
const { sql } = require('slonik');

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
  describe('parsing branchId and trunkVersion from submission xml', () => {
    it('should parse and save branch info from sub creating an entity', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');
      const branchId = uuid();

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('branchId=""', `branchId="${branchId}"`)
        )
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
          body.currentVersion.branchId.should.equal(branchId);
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

    it('should ignore empty string trunkVersion and branchId values in create scenario', testOfflineEntities(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('trunkVersion="1"', `trunkVersion=""`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd')
        .expect(200)
        .then(({ body }) => {
          body.currentVersion.version.should.equal(1);
          should.not.exist(body.currentVersion.baseVersion);
          body.currentVersion.data.should.eql({ age: '20', status: 'new', first_name: 'Megan' });

          should.not.exist(body.currentVersion.trunkVersion);
          should.not.exist(body.currentVersion.branchBaseVersion);
          should.not.exist(body.currentVersion.branchId);
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
        .send(testData.instances.offlineEntity.two
          .replace('branchId=""', `branchId="${branchId}"`)
        )
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

      await asAlice.get('/v1/projects/1/forms/offlineEntity/submissions/one-update2/audits')
        .expect(200)
        .then(({ body }) => {
          body[1].action.should.equal('submission.reprocess');
        });

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

      // Second submission updates the entity but entity hasn't been created yet
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

      // First submission creating the entity comes in later
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('branchId=""', `branchId="${branchId}"`)
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
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('branchId=""', `branchId="${branchId}"`)
        )
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
  });
});
