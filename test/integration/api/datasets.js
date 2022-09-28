const { testService } = require('../setup');
const testData = require('../../data/xml');
const config = require('config');

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

describe('projects/:id/forms/:formId/draft/attachment/link-dataset POST', () => {
  it('should link dataset to form and returns in manifest', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv/link-dataset')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200))
        .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            const domain = config.get('default.env.domain');
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile>
      <filename>goodone.csv</filename>
      <hash>md5:0c0fb6b2ee7dbb235035f7f6fdcfe8fb</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/goodone.csv</downloadUrl>
    </mediaFile>
  </manifest>`);
          })))));

  it('should match dataset name with attachment name', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv/link-dataset')
          .expect(404)))));
});

describe('projects/:id/forms/:formId/draft/attachment/unlink-dataset POST', () => {
  it('should unlink dataset and should not return in manifest', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv/link-dataset')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv/unlink-dataset')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200))
        .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
          })))));
});
