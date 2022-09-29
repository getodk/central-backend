/* eslint-disable no-console */
const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testService } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const testData = require(appRoot + '/test/data/xml.js');
// eslint-disable-next-line import/no-dynamic-require
const { createEntityFromSubmission } = require(appRoot + '/lib/worker/entity');
// eslint-disable-next-line import/no-dynamic-require
//const { exhaust } = require(appRoot + '/lib/worker/worker');


describe('worker: entity', () => {
  it('should write entity from submission', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => container.Submissions.getCurrentDefByIds(1, 'simpleEntity', 'one', false))
        .then((o) => o.get())
        .then((subDef) => createEntityFromSubmission(container, { details: { submissionDefId: subDef.id, reviewState: 'approved' } }))
        .then(() => container.oneFirst(sql`select count(*) from entities`))
        .then((count) => { Number(count).should.equal(1); }))));

  it('should write entity from submission', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200))
        .then(() => container.Audits.getLatestByAction('submission.update'))
        .then((o) => o.get())
        .then((event) => createEntityFromSubmission(container, event))
        .then(() => container.oneFirst(sql`select count(*) from entities`))
        .then((count) => { Number(count).should.equal(1); }))));
});

