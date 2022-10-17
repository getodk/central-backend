const appRoot = require('app-root-path');
const { sql } = require('slonik');
const should = require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');


describe('entities, etc.', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // ASSORTED ENTITY-RELATED TESTS THAT DON'T FIT BETTER ELSEWHERE
  ////////////////////////////////////////////////////////////////////////////////
  describe('processing a non-entity submission', () => {
    it('should gracefully handle processing a non-entity submission', testService(async (service, { Entities, Submissions, one }) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200));

      // Look up the submission to be able to get the corresponding form def
      const subDef = await Submissions.getCurrentDefByIds(1, 'simple', 'one', false).then((s) => s.get());

      // Processing a submission without an entity should not yield
      // any errors but it should also not create any entities.
      const entity = await Entities.processSubmissionDef(subDef.id);
      should.not.exist(entity);
      const { count } = await one(sql`select count(*) from entities`);
      count.should.equal(0);
    }));

    it('should not make entity from non-entity approved submission', testService(async (service, container) => {
      // When *any* submission is approved, the entity worker will look at it
      // to determine if it contains an entity to be created.
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
    }));
  });

  it('should create an entity from a submission', testService(async (service, { Entities, Submissions, one }) => {
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200)));

    // Look up the submission to be able to get the corresponding form def
    const subDef = await Submissions.getCurrentDefByIds(1, 'simpleEntity', 'one', false).then((s) => s.get());

    const entity = await Entities.processSubmissionDef(subDef.id);
    entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
    entity.label.should.equal('Alice (88)');
    entity.createdBy.should.equal(5); // submitter ID of Alice
    entity.def.data.should.eql({ first_name: 'Alice', age: '88' });

    const { count } = await one(sql`select count(*) from entities`);
    count.should.equal(1);
  }));

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

    const approveEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());

    const event = await container.Audits.getLatestByAction('entity.create').then((o) => o.get());
    event.actorId.should.equal(6); // Bob
    event.details.submissionId.should.equal(approveEvent.details.submissionId);

    const entity = await container.Entities.getByUuid(event.details.entityUuid).then((o) => o.get());
    entity.label.should.equal('Alice (88)');
  }));

  it.skip('should log entity error in audit log', testService(async (service, container) => {
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace('people', 'invalid.dataset'))
          .set('Content-Type', 'application/xml')
          .expect(200)));

    await service.login('bob', (asBob) =>
      asBob.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200));

    await exhaust(container);

    const approveEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());

    const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
    event.actorId.should.equal(6); // Bob
    event.details.submissionId.should.equal(approveEvent.details.submissionId);
    // TODO: nonexistent dataset currently throwing the wrong kind of error
    should.exist(event.details.problem);
  }));

  it('should log entity error in audit log', testService(async (service, container) => {
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace('uuid', 'nomoreuuid'))
          .set('Content-Type', 'application/xml')
          .expect(200)));

    await service.login('bob', (asBob) =>
      asBob.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200));

    await exhaust(container);

    const approveEvent = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());

    const event = await container.Audits.getLatestByAction('entity.create.error').then((o) => o.get());
    event.actorId.should.equal(6); // Bob
    event.details.submissionId.should.equal(approveEvent.details.submissionId);
    event.details.problem.problemCode.should.equal(409.14);
  }));

  it('should write out some csv stuff from worker', testService((service, container) =>
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
        .then(() => asAlice.get('/v1/projects/1/datasets/people/download')
          .then(({ text }) => {
            // eslint-disable-next-line no-console
            //console.log(text);
            const csv = text.split('\n');
            csv[0].includes('name,label,first_name,age').should.equal(true);
            csv[1].includes('Alice (88),Alice,88').should.equal(true);
            csv[2].includes('Beth (88),Beth,88').should.equal(true);
          })))));

  describe('errors (in parsing, in saving, etc.)', () => {
    it('should throw an error when reprocessing an already used submission def', testService(async (service, { Entities, Submissions }) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one)
            .set('Content-Type', 'application/xml')
            .expect(200)));

      // first time making entity from submission
      const subDef = await Submissions.getCurrentDefByIds(1, 'simpleEntity', 'one', false).then((s) => s.get());
      await Entities.processSubmissionDef(subDef.id);

      // forcing the reprocessing of entity
      const err = await Entities.processSubmissionDef(subDef.id).should.be.rejected();
      err.problemCode.should.equal(409.14);
      err.problemDetails.reason.should.equal('This submission was already used to create an entity.');
    }));

    it('should have worker succeed even if entity creation fails in a known way (reprocessing submission def)', testService(async (service, container) => {
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

      // reapprove submission - creating a new event that should not thwart worker
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200));

      // check event used to trigger submission updating
      let event = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.not.exist(event.processed);

      await exhaust(container);

      // event should look like it was sucessfully processed
      event = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(event.processed);
      event.failures.should.equal(0);
    }));

    it('should have worker succeed even if entity creation fails because of duplicate uuid', testService(async (service, container) => {
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

      // reapprove submission - creating a new event that should not thwart worker
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace('<instanceID>one', '<instanceID>two'))
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
            .send({ reviewState: 'approved' })
            .expect(200)));

      // check event used to trigger submission updating
      let event = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.not.exist(event.processed);

      await exhaust(container);

      // event should look like it was sucessfully processed
      event = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(event.processed);
      event.failures.should.equal(0);
    }));

    it('should have worker succeed even if entity creation fails because of invalid dataset', testService(async (service, container) => {
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

      // reapprove submission - creating a new event that should not thwart worker
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace('<instanceID>one', '<instanceID>two').replace('people', 'frogs'))
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
            .send({ reviewState: 'approved' })
            .expect(200)));

      // check event used to trigger submission updating
      const event = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.not.exist(event.processed);

      await exhaust(container);

      // event should look like it was sucessfully processed
      const event2 = await container.Audits.getLatestByAction('submission.update').then((o) => o.get());
      should.exist(event2.processed);
      event2.failures.should.equal(0);
    }));
  });
});
