const testData = require('../../data/xml');
const { testService } = require('../setup');

describe('Entities from Repeats', () => {
  describe('submitting forms and submissions', () => {
    it('should send form and submission that collects entities for multiple trees in a repeat group', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityTrees)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/repeatEntityTrees/submissions')
        .send(testData.instances.repeatEntityTrees.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));

    it('should send form and submission that collects entities about household and multiple people', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.repeatEntityHousehold)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/repeatEntityHousehold/submissions')
        .send(testData.instances.repeatEntityHousehold.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));

    it('should send form and submission about two entities at different levels: farm and farmer', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.multiEntityFarm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/multiEntityFarm/submissions')
        .send(testData.instances.multiEntityFarm.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));
  });
});
