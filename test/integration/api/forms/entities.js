const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const config = require('config');
const superagent = require('superagent');
const { DateTime } = require('luxon');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');
const { exhaust } = require(appRoot + '/lib/worker/worker');

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

    it('should still work on non-entity forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.xmlFormId.should.equal('simple2');
          }))));
  });
});
