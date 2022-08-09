const appRoot = require('app-root-path');
const { testTask } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const { purgeForms } = require(appRoot + '/lib/task/purge');

// The basics of this task are tested here, including returning the count
// eslint-disable-next-line no-trailing-spaces
// of purged forms, but the full functionality is more thoroughly tested in 
// test/integration/other/form-purging.js

describe('task: purge deleted forms', () => {
  it('should not purge recently deleted forms by default', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms())
        .then((count) => {
          count.should.equal(0);
        }))));

  it('should purge recently deleted form if forced', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(true))
        .then((count) => {
          count.should.equal(1);
        }))));

  it('should return count for multiple forms purged', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
        // eslint-disable-next-line no-shadow
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(true))
          .then((count) => {
            count.should.equal(2);
          })))));

  it('should not purge specific recently deleted form', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(false, 1))
        .then((count) => {
          count.should.equal(0);
        }))));

  it('should purge specific recently deleted form if forced', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(true, 1))
        .then((count) => {
          count.should.equal(1);
        }))));

  it('should force purge only specific form', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
        // eslint-disable-next-line no-shadow
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(true, 1))
          .then((count) => {
            count.should.equal(1);
          })))));

  describe('with projectId', () => {
    it('should not purge recently deleted forms even if projectId is matched', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(null, null, 1))
          .then((count) => {
            count.should.equal(0);
          }))));

    it('should not purge recently deleted forms even if projectId AND formId is matched', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(null, 1, 1))
          .then((count) => {
            count.should.equal(0);
          }))));

    it('should purge specific form', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, 1, 1))
            .then((count) => {
              count.should.equal(1);
            })))));

    it('should not purge specific form if tied to a different project', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, 1, 2))
            .then((count) => {
              count.should.equal(0);
            })))));

    it('should not purge all forms if no form ID supplied', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, null, 1))
            .then((count) => {
              count.should.equal(2);
            })))));

    it('should not purge multiple forms if tied to a different project', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, null, 2))
            .then((count) => {
              count.should.equal(0);
            })))));
  });
});

