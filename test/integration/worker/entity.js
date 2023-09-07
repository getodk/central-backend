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
      should.exist(secondApproveEvent.processed);
      firstApproveEvent.id.should.not.equal(secondApproveEvent.id);

      // there should be no log of an entity-creation error
      const errorEvent = await container.Audits.getLatestByAction('entity.create.error');
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
      const errorEvent = await container.Audits.getLatestByAction('entity.create.error');
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

  describe('should make an entity', () => {
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

      // Don't have Entites.getEntityById() yet so we'll quickly check the DB directly
      const { count } = await container.one(sql`select count(*) from entities`);
      count.should.equal(1);

      const { data, label, creatorId, userAgent } = await container.one(sql`select data, label, "creatorId", "userAgent" from entity_defs`);
      label.should.equal('Alice (88)');
      data.age.should.equal('88');
      data.first_name.should.equal('Alice');
      creatorId.should.equal(5); // Alice the user created this entity
      userAgent.should.equal('central/tests');
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
        event.details.errorMessage.should.equal('Invalid input data type: expected (uuid) to be (valid UUID)');
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

        const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
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
        const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
        should.exist(event);
        // The error in this case is not one of our Problems but an error thrown by slonik
        // from passing in some broken (undefined/missing) value for submissionDefId.
        should.exist(event.details.errorMessage);
        should.not.exist(event.details.problem);
        event.details.errorMessage.should.equal('relation "forms" does not exist');
      }));
    });
  });

  describe('listing entities as dataset CSVs', () => {
    it('should stream out simple entity csv', testService((service, container) =>
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

              const withOutTs = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g, '');
              withOutTs.should.be.eql(
                '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
                '12345678-1234-4123-8234-123456789def,Beth (88),Beth,88,,5,Alice,0,,1\n'+
                '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88,,5,Alice,0,,1\n'
              );
            })))));

    it('should export dataset from multiple forms', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.multiPropertyEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.multiPropertyEntity
          .replace('multiPropertyEntity', 'multiPropertyEntity2')
          .replace('b_q1', 'f_q1')
          .replace('d_q2', 'e_q2'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft/publish').expect(200);

      await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/submissions')
        .send(testData.instances.multiPropertyEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/submissions')
        .send(testData.instances.multiPropertyEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/multiPropertyEntity2/submissions')
        .send(testData.instances.multiPropertyEntity.one
          .replace('multiPropertyEntity', 'multiPropertyEntity2')
          .replace('uuid:12345678-1234-4123-8234-123456789aaa', 'uuid:12345678-1234-4123-8234-123456789ccc')
          .replace('b_q1', 'f_q1')
          .replace('d_q2', 'e_q2'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/multiPropertyEntity/submissions/one')
        .send({ reviewState: 'approved' });
      await asAlice.patch('/v1/projects/1/forms/multiPropertyEntity/submissions/two')
        .send({ reviewState: 'approved' });
      await asAlice.patch('/v1/projects/1/forms/multiPropertyEntity2/submissions/one')
        .send({ reviewState: 'approved' });

      await exhaust(container);

      const { text } = await asAlice.get('/v1/projects/1/datasets/foo/entities.csv');

      const withOutTs = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g, '');
      withOutTs.should.be.eql(
        '__id,label,f_q1,e_q2,a_q3,c_q4,b_q1,d_q2,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
        '12345678-1234-4123-8234-123456789ccc,one,w,x,y,z,,,,5,Alice,0,,1\n'+
        '12345678-1234-4123-8234-123456789bbb,two,,,c,d,a,b,,5,Alice,0,,1\n'+
        '12345678-1234-4123-8234-123456789aaa,one,,,y,z,w,x,,5,Alice,0,,1\n'
      );
    }));
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

      const errors = await container.Audits.get(new QueryOptions({ args: { action: 'entity.create.error' } }));

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

      const errors = await container.Audits.get(new QueryOptions({ args: { action: 'entity.create.error' } }));

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
});

