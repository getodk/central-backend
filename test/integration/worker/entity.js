const appRoot = require('app-root-path');
const { sql } = require('slonik');
const should = require('should');

const { testService } = require('../setup');
const { QueryOptions } = require('../../../lib/util/db');
const testData = require(appRoot + '/test/data/xml.js');
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
      const errorEvent = await container.Audits.getLatestByAction('entity.error');
      createEvent.isEmpty().should.equal(true);
      errorEvent.isEmpty().should.equal(true);
    }));

    it('should not make entity for rejected entity submission', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/datasets/people')
            .send({ approvalRequired: true })
            .expect(200))
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
      const errorEvent = await container.Audits.getLatestByAction('entity.error');
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
      const errorEvent = await container.Audits.getLatestByAction('entity.error');
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
      should.exist(secondApproveEvent.processed);
      firstApproveEvent.id.should.not.equal(secondApproveEvent.id);

      // there should be no log of an entity-creation error
      const errorEvent = await container.Audits.getLatestByAction('entity.error');
      errorEvent.isEmpty().should.be.true();
    }));

    it('should not make an entity when reprocessing an edited submission', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200));

      await exhaust(container);

      const firstApproveEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(firstApproveEvent.processed);

      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(testData.instances.simpleEntity.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')),
        { filename: 'data.xml' })
        .expect(201)
        .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200));

      await exhaust(container);

      const secondApproveEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      firstApproveEvent.id.should.not.equal(secondApproveEvent.id);
      should.exist(secondApproveEvent.processed);

      // there should be no log of an entity-creation error
      const errorEvent = await container.Audits.getLatestByAction('entity.error');
      errorEvent.isEmpty().should.be.true();
    }));

    it('should not make entity for draft submission', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body }) => body.should.be.eql([]));

    }));

    // TODO: check that it doesn't make an entity for an encrypted form/submission
  });

  describe('should successfully process submissions about entities', () => {
    it('should log entity creation in audit log', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/datasets/people')
            .send({ approvalRequired: true })
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one)
            .set('Content-Type', 'application/xml')
            .set('User-Agent', 'central/tests')
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
      createEvent.details.entity.dataset.should.equal('people');
      createEvent.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
    }));

    it('should log entity update in audit log', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asBob.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const updateEvent = await container.Audits.getLatestByAction('submission.create').then((o) => o.get());
      should.exist(updateEvent.processed);
      updateEvent.failures.should.equal(0);

      const createEvent = await container.Audits.getLatestByAction('entity.update.version').then((o) => o.get());
      createEvent.actorId.should.equal(6); // Bob
      createEvent.details.submissionId.should.equal(updateEvent.details.submissionId);

      // should contain information about entity
      createEvent.details.entity.dataset.should.equal('people');
      createEvent.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
    }));
  });

  describe('should catch problems creating new entity', () => {
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

        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(updateEvent.details.submissionId);
        event.details.errorMessage.should.equal('Invalid input data type: expected (uuid) to be (valid version 4 UUID)');
        event.details.problem.problemCode.should.equal(400.11);
      }));

      it('should fail because dataset attribute is missing', testService(async (service, container) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one.replace('dataset="people" ', ''))
              .set('Content-Type', 'application/xml')
              .expect(200)));

        await exhaust(container);

        // Submission event should look successful
        const updateEvent = await container.Audits.getLatestByAction('submission.create').then((o) => o.get());
        should.exist(updateEvent.processed);
        updateEvent.failures.should.equal(0);

        const createEvent = await container.Audits.getLatestByAction('entity.create');
        createEvent.isEmpty().should.be.true();

        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(updateEvent.details.submissionId);
        event.details.errorMessage.should.equal('Required parameter dataset missing.');
        event.details.problem.problemCode.should.equal(400.2);
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
        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
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
        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(updateEvent.details.submissionId);
        event.details.problem.problemCode.should.equal(404.7);
        event.details.errorMessage.should.match(/The dataset \(frogs\) specified in the submission does not exist/);
      }));

      it('should fail and log other system errors', testService(async (service, container) => {
        // cause system error by dropping `forms` table
        await container.run(sql`DROP TABLE forms CASCADE`);
        await container.Audits.log(null, 'submission.update', null, { reviewState: 'approved', submissionDefMissing: true });
        await exhaust(container);

        // most recent submission update event should look like it was sucessfully processed
        const updateEvent2 = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
        should.exist(updateEvent2.processed);
        updateEvent2.failures.should.equal(0);

        // the entity creation error should be logged
        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        should.exist(event);
        // The error in this case is not one of our Problems but an error thrown by slonik
        // from passing in some broken (undefined/missing) value for submissionDefId.
        should.exist(event.details.errorMessage);
        should.not.exist(event.details.problem);
        event.details.errorMessage.should.equal('relation "forms" does not exist');
      }));
    });
  });

  describe('should catch problems updating entity', () => {
    describe('validation errors', () => {
      it('should fail because UUID is invalid', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // create an initial entity to update
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
        await exhaust(container);
        // create form and submission to update entity
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one.replace('12345678-1234-4123-8234-123456789abc', 'bad_uuid'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);

        // Submission event should look successful
        const subEvent = await container.Audits.getLatestByAction('submission.create').then((o) => o.get());
        should.exist(subEvent.processed);
        subEvent.failures.should.equal(0);

        const updateEvent = await container.Audits.getLatestByAction('entity.update');
        updateEvent.isEmpty().should.be.true();

        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(subEvent.details.submissionId);
        event.details.errorMessage.should.equal('Invalid input data type: expected (uuid) to be (valid version 4 UUID)');
        event.details.problem.problemCode.should.equal(400.11);
      }));

      it('should fail because dataset attribute is missing', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // create an initial entity to update
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
        await exhaust(container);
        // create form and submission to update entity
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one.replace('people', ''))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);

        // Submission event should look successful
        const subEvent = await container.Audits.getLatestByAction('submission.create').then((o) => o.get());
        should.exist(subEvent.processed);
        subEvent.failures.should.equal(0);

        const udpateEvent = await container.Audits.getLatestByAction('entity.update');
        udpateEvent.isEmpty().should.be.true();

        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(subEvent.details.submissionId);
        event.details.errorMessage.should.equal('Required parameter dataset missing.');
        event.details.problem.problemCode.should.equal(400.2);
      }));
    });

    describe('constraint errors', () => {
      it('should fail if trying to update an entity by uuid that does not exist', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // create an initial entity to update
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789bad', // not the uuid in updateEntity.one
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);
        await exhaust(container);
        // create form and submission to update entity
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);

        // most recent submission event should look like it was sucessfully processed
        const subEvent = await container.Audits.getLatestByAction('submission.create').then((o) => o.get());
        should.exist(subEvent.processed);
        subEvent.failures.should.equal(0);

        // the entity processing error should be logged
        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(subEvent.details.submissionId);
        event.details.problem.problemCode.should.equal(404.8);
        event.details.errorMessage.should.equal('The entity with UUID (12345678-1234-4123-8234-123456789abc) specified in the submission does not exist in the dataset (people).');
      }));

      it('should fail for other constraint errors like dataset name does not exist', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // create an initial entity to update
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789bad', // not the uuid in updateEntity.one
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);
        await exhaust(container);
        // create form and submission to update entity
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one.replace('people', 'frogs'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);

        // most recent submission event should look like it was sucessfully processed
        const subEvent = await container.Audits.getLatestByAction('submission.create').then((o) => o.get());
        should.exist(subEvent.processed);
        subEvent.failures.should.equal(0);

        // the entity processing error should be logged
        const event = await container.Audits.getLatestByAction('entity.error').then((o) => o.get());
        event.actorId.should.equal(5); // Alice
        event.details.submissionId.should.equal(subEvent.details.submissionId);
        event.details.problem.problemCode.should.equal(404.7);
        event.details.errorMessage.should.match(/The dataset \(frogs\) specified in the submission does not exist/);
      }));
    });
  });

  describe('event processing based on approvalRequired flag', () => {
    it('should create entity on submission creation when approvalRequired is false', testService(async (service, container) => {
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

      const entity = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => body);

      entity.should.not.be.null();
      entity.currentVersion.data.first_name.should.equal('Alice');
    }));

    it('should create entity on submission approval when approvalRequired is true', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(404);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      const entity = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => body);

      entity.should.not.be.null();
      entity.currentVersion.data.first_name.should.equal('Alice');
    }));

    it('should create entity on submission update when approvalRequired is false and it was not created on submission receipt', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one.replace('create="1"', 'create="0"'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(404);

      await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send(testData.instances.simpleEntity.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const entity = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => body);

      entity.should.not.be.null();
      entity.currentVersion.data.first_name.should.equal('Alice');
    }));

    it('should create entity on approval of submission update when approvalRequired is true and entity was not created previously', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one.replace('create="1"', 'create="0"'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(404);

      await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send(testData.instances.simpleEntity.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(404);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      const entity = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => body);

      entity.should.not.be.null();
      entity.currentVersion.data.first_name.should.equal('Alice');
    }));

    it('should not create a new entity on edit if it was created on submission receipt', testService(async (service, container) => {
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

      const entity = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => body);

      entity.should.not.be.null();
      entity.currentVersion.data.first_name.should.equal('Alice');

      await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send(testData.instances.simpleEntity.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body }) => body.length.should.be.eql(1));

      const errors = await container.Audits.get(new QueryOptions({ args: { action: 'entity.error' } }));

      errors.should.be.empty();

    }));

    it('should not create on approval if approval is not required', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
        .send({ approvalRequired: false })
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(404);

      const errors = await container.Audits.get(new QueryOptions({ args: { action: 'entity.error' } }));

      errors.should.be.empty();

    }));

    it('should not create entity when review status is rejected', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      // review status is null
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // review status is edited
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/two')
          .send(testData.instances.simpleEntity.two
            .replace('<instanceID>two', '<deprecatedID>two</deprecatedID><instanceID>two2'))
          .set('Content-Type', 'application/xml')
          .expect(200));

      // review status is hasIssues
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.three)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/three')
          .send({ reviewState: 'hasIssues' })
          .expect(200));

      // review status is rejected
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.four)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/four')
          .send({ reviewState: 'rejected' })
          .expect(200));

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body }) => body.should.be.eql([]));

      await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
        .send({ approvalRequired: false })
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities')
        .expect(200)
        .then(({ body }) => {
          body.length.should.be.eql(3);
          body.map(e => e.uuid).should.not.containEql('12345678-1234-4123-8234-123456789ccc');
        });
    }));
  });

  describe('event processing of entity updates only on submission.create regardless of approvalRequired', () => {
    it('should update entity on submission.create even if approvalRequired is true for new entities', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      // Need an entity to update, but will make it through the API
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      // create form and submission to update entity
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // entity audit log should point to submission create event as source
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].action.should.be.eql('entity.update.version');
          logs[0].details.source.event.action.should.be.eql('submission.create');
        });
    }));

    it('should not process submission.update (approval) for entity update', testService(async (service, container) => {
      // approving the submission wont update the entity because there is already an entity def associated with this submission
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      // Need an entity to update, but will make it through the API
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      // create form and submission to update entity
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // approve submission
      await asAlice.patch('/v1/projects/1/forms/updateEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      const subEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(subEvent.processed);
      subEvent.failures.should.equal(0);

      const updateCount = await container.oneFirst(sql`select count(*) from audits where action = 'entity.update.version'`);
      updateCount.should.equal(1); // only the original update from submission.count should be present
    }));

    it('should never process submission.update for entity update even if submission.create gets skipped', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      // Need an entity to update, but will make it through the API
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      // create form and submission to update entity
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // set submission.create audit event to already be processed
      await container.run(sql`update audits set processed=now() where action = 'submission.create'`);

      // approve submission
      await asAlice.patch('/v1/projects/1/forms/updateEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      const subEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(subEvent.processed);
      subEvent.failures.should.equal(0);

      // There should be no entity update events logged.
      const createEvent = await container.Audits.getLatestByAction('entity.update.version');
      const errorEvent = await container.Audits.getLatestByAction('entity.error');
      createEvent.isEmpty().should.equal(true);
      errorEvent.isEmpty().should.equal(true);
    }));

  });
});

