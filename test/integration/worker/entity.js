const appRoot = require('app-root-path');
const { sql } = require('slonik');
const should = require('should');

const { testService } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const testData = require(appRoot + '/test/data/xml.js');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');


describe('worker: entity', () => {
  describe('should not make an entity or log anything about entities', () => {
    it('should not make entity for approved submission for non-entity form', testService(async (service, container) => {
      // This submission contains no entity data. The worker will look at it anyway
      // to establish that it isn't about an entity, but it should not log any entity-related event.
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
            .send({ reviewState: 'approved' })
            .expect(200)));

      await exhaust(container);

      const { count } = await container.one(sql`select count(*) from entities`);
      count.should.equal(0);

      // Original submission update event should look like it was successfully processed with no failures.
      const updateEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(updateEvent.processed);
      updateEvent.failures.should.equal(0);

      // There should be no entity events logged.
      const createEvent = await container.Audits.getLatestByAction('entity.create');
      const errorEvent = await container.Audits.getLatestByAction('entity.create.error');
      createEvent.isEmpty().should.equal(true);
      errorEvent.isEmpty().should.equal(true);
    }));

    it('should not make entity for rejected entity submission', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
            .send({ reviewState: 'rejected' })
            .expect(200)));

      await exhaust(container);

      const { count } = await container.one(sql`select count(*) from entities`);
      count.should.equal(0);

      // Original submission update event should look like it was successfully processed with no failures.
      const updateEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(updateEvent.processed);
      updateEvent.failures.should.equal(0);

      // There should be no entity events logged.
      const createEvent = await container.Audits.getLatestByAction('entity.create');
      const errorEvent = await container.Audits.getLatestByAction('entity.create.error');
      createEvent.isEmpty().should.equal(true);
      errorEvent.isEmpty().should.equal(true);
    }));

    it('should not make entity for create=false submission', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one.replace('create="1"', 'create="false"'))
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
            .send({ reviewState: 'approved' })
            .expect(200)));

      await exhaust(container);

      const { count } = await container.one(sql`select count(*) from entities`);
      count.should.equal(0);

      // Original submission update event should look like it was successfully processed with no failures.
      const updateEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(updateEvent.processed);
      updateEvent.failures.should.equal(0);

      // There should be no entity events logged.
      const createEvent = await container.Audits.getLatestByAction('entity.create');
      const errorEvent = await container.Audits.getLatestByAction('entity.create.error');
      createEvent.isEmpty().should.equal(true);
      errorEvent.isEmpty().should.equal(true);
    }));

    it('should not make an entity when reprocessing a submission', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
            .send({ reviewState: 'approved' })
            .expect(200)));

      await exhaust(container);

      const firstApproveEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(firstApproveEvent.processed);

      // reapprove submission - creating a new event that should not thwart worker
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200));

      await exhaust(container);

      // second event should look like it was processed.
      // also double-checking that there was a second event and another entity really was not made.
      const secondApproveEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(firstApproveEvent.processed);
      firstApproveEvent.id.should.not.equal(secondApproveEvent.id);

      // there should be no log of an entity-creation error
      const errorEvent = await container.Audits.getLatestByAction('entity.create.error');
      errorEvent.isEmpty().should.be.true();
    }));

    // TODO: check that it doesn't make an entity for an encrypted form/submission
  });

  describe('should make an entity', () => {
    it('should log entity creation in audit log', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one)
            .set('Content-Type', 'application/xml')
            .expect(200)));

      await service.login('bob', (asBob) =>
        asBob.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200));

      await exhaust(container);

      const updateEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(updateEvent.processed);
      updateEvent.failures.should.equal(0);

      const createEvent = await container.Audits.getLatestByAction('entity.create').then((o) => o.get());
      createEvent.actorId.should.equal(6); // Bob
      createEvent.details.submissionId.should.equal(updateEvent.details.submissionId);

      // should contain information about entity
      createEvent.details.entity.label.should.equal('Alice (88)');
      createEvent.details.entity.dataset.should.equal('people');
      createEvent.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');

      // Don't have Entites.getEntityById() yet so we'll quickly check the DB directly
      const { count } = await container.one(sql`select count(*) from entities`);
      count.should.equal(1);

      const { label } = await container.one(sql`select label from entities where "uuid" = ${createEvent.details.entity.uuid}`);
      label.should.equal('Alice (88)');

      const { data } = await container.one(sql`select data from entity_defs`);
      data.age.should.equal('88');
      data.first_name.should.equal('Alice');
    }));
  });

  describe('should catch problems making entities', () => {
    // These validation errors are ones we can catch before trying to insert the new entity
    // in the database. They likely point to a form design error that we want to try to surface.
    // There are more tests of validation errors in test/unit/data/entity.
    describe('validation errors', () => {
      it('should fail because UUID is invalid', testService(async (service, container) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one.replace('uuid:12345678-1234-4123-8234-123456789abc', 'bad_uuid'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
              .send({ reviewState: 'approved' })
              .expect(200)));

        await exhaust(container);

        // Submission event should look successful
        const updateEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
        should.exist(updateEvent.processed);
        updateEvent.failures.should.equal(0);

        const createEvent = await container.Audits.getLatestByAction('entity.create');
        createEvent.isEmpty().should.be.true();

        const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(updateEvent.details.submissionId);
        event.details.errorMessage.should.equal('There was a problem with entity processing: ID [bad_uuid] is not a valid UUID.');
        event.details.problem.problemCode.should.equal(409.14);
      }));
    });

    describe('constraint errors', () => {
      it('should fail if trying to use an entity uuid that exists', testService(async (service, container) => {
        // We check separately if a submission has already been processed, but we rely on the database constraint
        // errors for avoiding duplicate UUIDs and other collisions.
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one)
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
              .send({ reviewState: 'approved' })
              .expect(200)));

        await exhaust(container);

        // Check that the first entity was created
        const { count } = await container.one(sql`select count(*) from entities`);
        count.should.equal(1);

        // Create a new submission (by changing the instance ID) with the same entity UUID
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one.replace('<instanceID>one', '<instanceID>two'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
              .send({ reviewState: 'approved' })
              .expect(200)));

        await exhaust(container);

        // most recent submission update event should look like it was sucessfully processed
        const updateEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
        should.exist(updateEvent.processed);
        updateEvent.failures.should.equal(0);

        // the entity creation error should be logged
        const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(updateEvent.details.submissionId);
        event.details.errorMessage.should.equal('A resource already exists with uuid value(s) of 12345678-1234-4123-8234-123456789abc.');
        event.details.problem.problemCode.should.equal(409.3);
      }));

      it('should fail for other constraint errors like dataset name does not exist', testService(async (service, container) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one.replace('people', 'frogs'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
              .send({ reviewState: 'approved' })
              .expect(200)));

        await exhaust(container);

        // most recent submission update event should look like it was sucessfully processed
        const updateEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
        should.exist(updateEvent.processed);
        updateEvent.failures.should.equal(0);

        // the entity creation error should be logged
        const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(updateEvent.details.submissionId);
        event.details.problem.problemCode.should.equal(400.14);
        // this is going to have an errorMessage of something cryptic database complaint
        // like "The given entityId 5 for entities does not exist."
      }));

      it('should fail and log other system errors', testService(async (service, container) => {
        // log a submission update event that is partly broken
        await container.Audits.log(null, 'submission.update', null, { reviewState: 'approved', submissionDefMissing: true });
        await exhaust(container);

        // most recent submission update event should look like it was sucessfully processed
        const updateEvent2 = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
        should.exist(updateEvent2.processed);
        updateEvent2.failures.should.equal(0);

        // the entity creation error should be logged
        const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
        should.exist(event);
        // The error in this case is not one of our Problems but an error thrown by slonik
        // from passing in some broken (undefined/missing) value for submissionDefId.
        should.exist(event.details.errorMessage);
        should.not.exist(event.details.problem);
        event.details.errorMessage.should.equal('SQL tag cannot be bound an undefined value.');
      }));
    });
  });

  describe('listing entities as dataset CSVs', () => {
    it('should stream out out some entity csv', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
            .send({ reviewState: 'approved' })
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one
              .replace('one', 'two')
              .replace('Alice', 'Beth')
              .replace('Alice', 'Beth')
              .replace('12345678-1234-4123-8234-123456789abc', '12345678-1234-4123-8234-123456789def'))
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
            .send({ reviewState: 'approved' })
            .expect(200))
          .then(() => exhaust(container))
          .then(() => asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .then(({ text }) => {
              // eslint-disable-next-line no-console
              //console.log(text);
              const csv = text.split('\n');
              csv[0].includes('name,label,first_name,age').should.equal(true);
              csv[1].includes('Alice (88),Alice,88').should.equal(true);
              csv[2].includes('Beth (88),Beth,88').should.equal(true);
            })))));
  });
});

