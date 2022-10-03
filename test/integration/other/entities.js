const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');


describe('entities, etc.', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // ASSORTED ENTITY-RELATED TESTS THAT DON'T FIT BETTER ELSEWHERE
  ////////////////////////////////////////////////////////////////////////////////

  it('should create an entity from a submission', testService(async (service, { Entities, Submissions, one }) => {
    // Upload an entity form and a submission for that form
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
    entity.uuid.should.equal('uuid:12345678-1234-1234-1234-123456789abc');
    entity.label.should.equal('Alice (88)');
    entity.createdBy.should.equal(5); // submitter ID of Alice
    entity.def.data.should.eql({ first_name: 'Alice', age: '88' });

    const { count } = await one(sql`select count(*) from entities`);
    count.should.equal(1);
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
            .replace('12345678-1234-1234-1234-123456789abc', '12345678-1234-1234-1234-123456789xyz'))
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
});
