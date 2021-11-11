const appPath = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const countFormRecords = (container, formId) => {
  return Promise.all([
    container.oneFirst(sql`select count(*) from forms where id=${formId}`),
    container.oneFirst(sql`select count(*) from form_defs where "formId"=${formId}`),
    container.oneFirst(sql`select count(*) from form_attachments where "formId"=${formId}`)
  ]);
};

describe.only('query module form purge', () => {
  it('should purge a soft-deleted form', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200)
        .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
        .then(() => countFormRecords(container, 1)
          .then((counts) => {
            counts.should.eql([0, 0, 0]);
          })))));
  
  it('should not find any matching forms records in the database', testService((service, container) =>
    service.login('alice', (asAlice) =>
      container.Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get())
        .then(( ghostForm ) => countFormRecords(container, ghostForm.id)
          .then((counts) => {
            counts.should.eql([1, 1, 0]);
          })
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200))
          .then(() => container.Forms.purge(true))
          .then(() => countFormRecords(container, ghostForm.id)
            .then((counts) => {
              counts.should.eql([0, 0, 0]);
            }))))));

  it('should log the purge action in the audit log', testService((service, container) =>
    service.login('alice', (asAlice) =>
      container.Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()) // get the form before we delete it
        .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
          .then(() => container.Audits.getLatestByAction('form.purge'))
          .then((audit) => {
            audit.isDefined().should.equal(true);
            audit.get().acteeId.should.equal(form.acteeId);
          })))));

  it('should update the actee table with purgedAt details', testService((service, container) =>
    service.login('alice', (asAlice) =>
      container.Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()) // get the form before we delete it
        .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
          .then(() => container.one(sql`select * from actees where id = ${form.acteeId}`))
          .then((res) => {
            const deletedFormDetails = {
              projectId: 1,
              formId: 1,
              xmlFormId: 'simple',
              name: 'Simple',
              version: ''
            };
            res.details.should.eql(deletedFormDetails);
          })))));

  it('should purge a form with multiple versions', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/draft')
        .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200))
        .then(() => countFormRecords(container, 1) // after delete, before purge
          .then((counts) => {
            counts.should.eql([1, 3, 0]);
          }))
        .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
        .then(() => countFormRecords(container, 1)
        .then((counts) => {
          counts.should.eql([0, 0, 0]);
        })))));

  it('should purge attachments of a form', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send('this is goodone.csv')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200))
        .then(() => container.Forms.getByProjectAndXmlFormId(1, 'withAttachments').then((o) => o.get())
        .then((ghostForm) => asAlice.delete('/v1/projects/1/forms/withAttachments')
          .expect(200)
          .then(() => countFormRecords(container, ghostForm.id)
            .then((counts) => {
              counts.should.eql([1, 1, 2]);
            }))
          .then(() => container.Forms.purge(true))
          .then(() => countFormRecords(container, ghostForm.id)
            .then((counts) => {
              counts.should.eql([0, 0, 0]);
            })))))));

});