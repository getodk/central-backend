const { testService } = require('../../setup');
const testData = require('../../../data/xml');

describe('api: /projects/:id/forms (entity-handling)', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // FORM CREATION RELATED TO ENTITIES
  ////////////////////////////////////////////////////////////////////////////////

  describe('parse form def to get entity def', () => {
    it('should return the created form upon success', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.xmlFormId.should.equal('simpleEntity');
          }))));
	});
});
