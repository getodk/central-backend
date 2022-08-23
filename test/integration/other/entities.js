const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');
// eslint-disable-next-line import/no-dynamic-require
const { getEntity } = require(appRoot + '/lib/data/submission');


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

      result.should.eql({
        name: 'Alice',
        age: '88',
        label: 'Alice (88)'
      });
    }));
  });
});
