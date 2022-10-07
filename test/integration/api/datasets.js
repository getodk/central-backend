const { testService } = require('../setup');
const testData = require('../../data/xml');
const config = require('config');
const { Form } = require('../../../lib/model/frames');
const { getOrNotFound } = require('../../../lib/util/promise');

// TODO merge with test/integration/api/forms/dataset.js

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

describe('projects/:id/forms/:formId/draft/attachment/:name PATCH', () => {
  it('should link dataset to form and returns in manifest', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200))
        .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
          .expect(200)
          .then(({ body }) => {
            body[0].name.should.equal('goodone.csv');
            body[0].datasetExists.should.equal(true);
            body[0].updatedAt.should.be.a.recentIsoDate();
          }))
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

  it('should override blob and link dataset', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send('test,csv\n1,2')
          .set('Content-Type', 'text/csv')
          .expect(200))
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
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

  it('should unlink dataset from the form', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(200))
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: false })
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200))
        .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
          .expect(200)
          .then(({ body }) => {
            body[0].name.should.equal('goodone.csv');
            body[0].datasetExists.should.equal(false);
            body[0].updatedAt.should.be.a.recentIsoDate();
          }))
        .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
          })))));

  it('should return error if dataset is not found', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(404)))));
});

describe('projects/:id/forms/:formId/draft/attachment/:name DELETE', () => {
  it('should unlink dataset from the form', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(200))
        .then(() => asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
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

describe('Check only blobId or datasetId is set', () => {
  // this scenario will never happen by just using APIs, adding this test for safety
  it('should throw problem 501.11 if both are being set', testService((service, { Forms, FormAttachments, Datasets }) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send('test,csv\n1,2')
          .set('Content-Type', 'text/csv')
          .expect(200))
        .then(() => Promise.all([
          Forms.getByProjectAndXmlFormId(1, 'withAttachments', false, Form.DraftVersion).then(getOrNotFound),
          Datasets.getByProjectAndName(1, 'goodone').then(getOrNotFound)
        ]))
        .then(([form, dataset]) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv').then(getOrNotFound)
          .then((attachment) => FormAttachments.update(form, attachment, 1, dataset.id)
            .catch(error => {
              error.problemCode.should.be.equal(501.11);
            }))))));
});
