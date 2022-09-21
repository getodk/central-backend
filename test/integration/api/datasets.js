const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('projects/:id/datasets GET', () => {
  it('should return the datasets of Default project', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() =>
          asAlice.get('/v1/projects/1/datasets')
            .expect(200)
            .then(({ body }) => {
              body.map(({ id, ...d }) => d).should.eql([
                { name: 'people', projectId: 1, revisionNumber: 0 }
              ]);
            })))));

  it('should not return draft datasets', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/, 'simpleEntity2')
            .replace(/people/, 'student'))
          .expect(200)
          .then(() =>
            asAlice.get('/v1/projects/1/datasets')
              .expect(200)
              .then(({ body }) => {
                body.map(({ id, ...d }) => d).should.eql([
                  { name: 'student', projectId: 1, revisionNumber: 0 }
                ]);
              }))))));
});
