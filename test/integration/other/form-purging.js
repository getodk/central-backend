const appPath = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const countFormRecords = (container, formId) => {
  console.log("formId", formId);
  return Promise.all([
    container.oneFirst(sql`select count(*) from forms where id=${formId}`),
    container.oneFirst(sql`select count(*) from form_defs where "formId"=${formId}`)
  ]);
};

describe('query module form purge', () => {
  it('should purge a soft-deleted form', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200)
        .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
        .then(() => countFormRecords(container, 1)
          .then(([ formCount, formDefCount ]) => {
            formCount.should.equal(0);
            formDefCount.should.equal(0);
          })))));
  
  it('should not find any matching forms records in the database', testService((service, container) =>
    service.login('alice', (asAlice) =>
      container.Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get())
        .then(( ghostForm ) => countFormRecords(container, ghostForm.id)
          .then(([ formCount, formDefCount ]) => {
            formCount.should.equal(1);
            formDefCount.should.equal(1);
          })
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200))
          .then(() => container.Forms.purge(true))
          .then(() => countFormRecords(container, ghostForm.id)
            .then(([ formCount, formDefCount ]) => {
              formCount.should.equal(0);
              formDefCount.should.equal(0);
            }))))));
});