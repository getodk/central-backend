const appRoot = require('app-root-path');
// eslint-disable-next-line no-unused-vars
const should = require('should');
const { testTask } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const { purgeForms } = require(appRoot + '/lib/task/purge');
// eslint-disable-next-line import/no-dynamic-require, no-unused-vars
const { setConfiguration } = require(appRoot + '/lib/task/config');

// The basics of this task are tested here, including returning the count
// eslint-disable-next-line no-trailing-spaces
// of purged forms, but the full functionality is more thoroughly tested in 
// test/integration/other/form-purging.js

describe('task: purge deleted forms', () => {
  it('should not purge recently deleted forms by default', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        // eslint-disable-next-line indent
      .then(() => purgeForms())
        // eslint-disable-next-line indent
      .then((count) => {
          // eslint-disable-next-line indent
        count.should.equal(0);
        // eslint-disable-next-line indent
      }))));

  it('should purge recently deleted form if forced', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        // eslint-disable-next-line indent
      .then(() => purgeForms(true))
        // eslint-disable-next-line indent
      .then((count) => {
          // eslint-disable-next-line indent
        count.should.equal(1);
        // eslint-disable-next-line indent
      }))));

  it('should return count for multiple forms purged', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        // eslint-disable-next-line indent
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
        // eslint-disable-next-line no-shadow, indent
      .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
      .then(() => purgeForms(true))
          // eslint-disable-next-line indent
      .then((count) => {
            // eslint-disable-next-line indent
        count.should.equal(2);
          // eslint-disable-next-line indent
      })))));

  it('should not purge specific recently deleted form', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        // eslint-disable-next-line indent
      .then(() => purgeForms(false, 1))
        // eslint-disable-next-line indent
      .then((count) => {
          // eslint-disable-next-line indent
        count.should.equal(0);
        // eslint-disable-next-line indent
      }))));

  it('should purge specific recently deleted form if forced', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        // eslint-disable-next-line indent
      .then(() => purgeForms(true, 1))
        // eslint-disable-next-line indent
      .then((count) => {
          // eslint-disable-next-line indent
        count.should.equal(1);
        // eslint-disable-next-line indent
      }))));

  it('should force purge only specific form', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        // eslint-disable-next-line indent
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
        // eslint-disable-next-line no-shadow, indent
      .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
      .then(() => purgeForms(true, 1))
          // eslint-disable-next-line indent
      .then((count) => {
            // eslint-disable-next-line indent
        count.should.equal(1);
          // eslint-disable-next-line indent
      })))));

  describe('with projectId', () => {
    it('should not purge recently deleted forms even if projectId is matched', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
        .then(() => purgeForms(null, null, 1))
          // eslint-disable-next-line indent
        .then((count) => {
            // eslint-disable-next-line indent
          count.should.equal(0);
          // eslint-disable-next-line indent
        }))));

    it('should not purge recently deleted forms even if projectId AND formId is matched', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
        .then(() => purgeForms(null, 1, 1))
          // eslint-disable-next-line indent
        .then((count) => {
            // eslint-disable-next-line indent
          count.should.equal(0);
          // eslint-disable-next-line indent
        }))));

    it('should purge specific form', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow, indent
        .then((form) => Forms.del(form.get())
            // eslint-disable-next-line indent
        .then(() => purgeForms(true, 1, 1))
            // eslint-disable-next-line indent
        .then((count) => {
              // eslint-disable-next-line indent
          count.should.equal(1);
            // eslint-disable-next-line indent
        })))));

    it('should not purge specific form if tied to a different project', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow, indent
        .then((form) => Forms.del(form.get())
            // eslint-disable-next-line indent
        .then(() => purgeForms(true, 1, 2))
            // eslint-disable-next-line indent
        .then((count) => {
              // eslint-disable-next-line indent
          count.should.equal(0);
            // eslint-disable-next-line indent
        })))));

    // eslint-disable-next-line indent
  it('should not purge all forms if no form ID supplied', testTask(({ Forms }) =>
      // eslint-disable-next-line indent
    Forms.getByProjectAndXmlFormId(1, 'simple')
        // eslint-disable-next-line indent
      .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow, indent
      .then((form) => Forms.del(form.get())
            // eslint-disable-next-line indent
      .then(() => purgeForms(true, null, 1))
            // eslint-disable-next-line indent
      .then((count) => {
              // eslint-disable-next-line indent
        count.should.equal(2);
            // eslint-disable-next-line indent
      })))));

    // eslint-disable-next-line indent
  it('should not purge multiple forms if tied to a different project', testTask(({ Forms }) =>
      // eslint-disable-next-line indent
    Forms.getByProjectAndXmlFormId(1, 'simple')
        // eslint-disable-next-line indent
      .then((form) => Forms.del(form.get())
          // eslint-disable-next-line indent
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat'))
          // eslint-disable-next-line no-shadow, indent
      .then((form) => Forms.del(form.get())
            // eslint-disable-next-line indent
      .then(() => purgeForms(true, null, 2))
            // eslint-disable-next-line indent
      .then((count) => {
              // eslint-disable-next-line indent
        count.should.equal(0);
            // eslint-disable-next-line indent
      })))));
  });
});

