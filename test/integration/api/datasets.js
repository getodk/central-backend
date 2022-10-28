const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const config = require('config');
const { Form } = require('../../../lib/model/frames');
const { getOrNotFound } = require('../../../lib/util/promise');
const { omit } = require('ramda');
// eslint-disable-next-line import/no-dynamic-require
const { createEntityFromSubmission } = require(appRoot + '/lib/worker/entity');
const should = require('should');

// TODO merge with test/integration/api/forms/dataset.js

describe('projects/:id/datasets', () => {
  describe('GET', () => {
    it('should reject if the user cannot list datasets', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/datasets')
              .expect(403))))));

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
                body.map(({ id, createdAt, ...d }) => d).should.eql([
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
                  body.map(({ id, createdAt, ...d }) => d).should.eql([
                    { name: 'student', projectId: 1, revisionNumber: 0 }
                  ]);
                }))))));
  });

  describe('GET: dataset download', () => {
    it('should reject if the user cannot access dataset', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/datasets/people/download')
              .expect(403))))));

    it('should let the user download the dataset (even if 0 entity rows)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/datasets/people/download')
            .expect(200)
            .then(({ text }) => {
              text.should.equal('name,label,first_name,age\n');
            })))));

    // TODO: right now this returns 500 internal server error
    it.skip('should reject if dataset does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/datasets/nonexistent/download')
            .expect(404)))));
  });
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
          .expect(200)
          .then(({ body }) => omit(['updatedAt'], body).should.be.eql({
            name: 'goodone.csv',
            type: 'file',
            blobExists: false,
            datasetExists: true
          })))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish?version=newversion')
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

  it('should override blob and link dataset', testService((service, { Forms, FormAttachments, Audits, Datasets }) =>
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
          .then(attachment => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .send({ dataset: true })
            .expect(200)
            .then(() => Audits.getLatestByAction('form.attachment.update').then(getOrNotFound)
              .then(({ details }) => {
                const { formDefId, ...attachmentDetails } = details;
                formDefId.should.not.be.null();
                attachmentDetails.should.be.eql({
                  name: 'goodone.csv',
                  oldBlobId: attachment.blobId,
                  newBlobId: null,
                  oldDatasetId: null,
                  newDatasetId: dataset.id
                });
              })))
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
            }))))));

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
              error.constraint.should.be.equal('check_blobId_or_datasetId_is_null');
            }))))));
});

describe('projects/:id/forms/:formId/attachments/:name (entities dataset)', () => {
  it('should return entities csv', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => container.Submissions.getCurrentDefByIds(1, 'simpleEntity', 'one', false)
          .then(getOrNotFound)
          .then((subDef) => createEntityFromSubmission(container, { details: { submissionDefId: subDef.id, reviewState: 'approved' } })))
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200))
        .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
          .expect(200)
          .then(({ headers, text }) => {
            headers['content-disposition'].should.equal('attachment; filename="goodone.csv"; filename*=UTF-8\'\'goodone.csv');
            headers['content-type'].should.equal('text/csv; charset=utf-8');
            text.should.equal('name,label,first_name,age\n12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88\n');
          })))));
});

describe('autolink dataset to attachments', () => {
  it('should set datasetId of attachment on form draft upload', testService((service, { Forms, FormAttachments }) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() =>
            Forms.getByProjectAndXmlFormId(1, 'withAttachments')
              .then(form => FormAttachments.getByFormDefIdAndName(form.value.def.id, 'people.csv')
                .then(attachment => {
                  attachment.value.datasetId.should.not.be.null();
                })))))));

  it('should not link dataset if previous version has blob', testService((service, { Forms, FormAttachments }) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
          .send('test,csv\n1,2')
          .set('Content-Type', 'text/csv')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() =>
          Forms.getByProjectAndXmlFormId(1, 'withAttachments')
            .then(form => FormAttachments.getByFormDefIdAndName(form.value.def.id, 'people.csv')
              .then(attachment => {
                should(attachment.value.datasetId).be.null();
                should(attachment.value.blobId).not.be.null();
              }))))));

  it('should link dataset if previous version does not have blob or dataset linked', testService((service, { Forms, FormAttachments }) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
          .send({ dataset: false })
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() =>
          Forms.getByProjectAndXmlFormId(1, 'withAttachments')
            .then(form => FormAttachments.getByFormDefIdAndName(form.value.def.id, 'people.csv')
              .then(attachment => {
                should(attachment.value.datasetId).not.be.null();
                should(attachment.value.blobId).be.null();
              }))))));
});
