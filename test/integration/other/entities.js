const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
// eslint-disable-next-line import/no-dynamic-require
const { getEntity } = require(appRoot + '/lib/data/submission');
// eslint-disable-next-line import/no-dynamic-require
const { Entity } = require(appRoot + '/lib/model/frames');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');


describe('entities, etc.', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // ASSORTED ENTITY-RELATED TESTS THAT DON'T FIT BETTER ELSEWHERE
  ////////////////////////////////////////////////////////////////////////////////

  describe('use the dataset property fields from form xml to parse submission', () => {
    it('should return the created form upon success', testService(async (service, { Datasets, Submissions }) => {
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

      // Retrieve the entity fields (form fields with dataset property information)
      const entityFields = await Datasets.getFieldsByFormDefId(subDef.formDefId);

      // Use the fields to parse the submission xml
      const result = await getEntity(entityFields, testData.instances.simpleEntity.one);

      result.name.should.equal('Alice');
      result.age.should.equal('88');
      result.label.should.equal('Alice (88)');
    }));
  });

  it('should create an entity in the database', testService(async (service, { Datasets, Entities, Submissions, all }) => {
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

    // Retrieve the entity fields (form fields with dataset property information)
    const entityFields = await Datasets.getFieldsByFormDefId(subDef.formDefId);

    // Use the fields to parse the submission xml
    const result = await getEntity(entityFields, testData.instances.simpleEntity.one);

    const partialEntity = Entity.fromData(1, subDef.id, result);
    await Entities.createNew(partialEntity);

    const res = await all(sql`select * from entities`);
    res[0].label.should.equal('Alice (88)');
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
            .replace('Alice', 'Beth'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
          .send({ reviewState: 'approved' })
          .expect(200))
        .then(() => exhaust(container))
        .then(() => asAlice.get('/v1/projects/1/datasets/1/download')
          .then(({ text }) => {
            // eslint-disable-next-line no-console
            //console.log(text);
            const csv = text.split('\n');
            csv[0].includes('name,label,name,age').should.equal(true);
            csv[1].includes('Alice (88),Alice,88').should.equal(true);
            csv[2].includes('Beth (88),Beth,88').should.equal(true);
          })))));
});
