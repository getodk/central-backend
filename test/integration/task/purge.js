const appRoot = require('app-root-path');
const assert = require('assert');
const { testTask } = require('../setup');
const { purgeForms } = require(appRoot + '/lib/task/purge');

// The basics of this task are tested here, including returning the message
// of purged forms, but the full functionality is more thoroughly tested in
// test/integration/other/form-purging.js

describe('task: purge deleted forms', () => {
  it('should not purge recently deleted forms by default', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms())
        .then((message) => {
          message.should.equal('Forms purged: 0');
        }))));

  it('should purge recently deleted form if forced', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(true))
        .then((message) => {
          message.should.equal('Forms purged: 1');
        }))));

  it('should return message for multiple forms purged', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get()))
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
        .then((form) => Forms.del(form.get())))
      .then(() => purgeForms(true)
        .then((message) => {
          message.should.equal('Forms purged: 2');
        }))));

  it('should not purge specific recently deleted form', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(false, 1))
        .then((message) => {
          message.should.equal('Forms purged: 0');
        }))));

  it('should purge specific recently deleted form if forced', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(true, 1))
        .then((message) => {
          message.should.equal('Forms purged: 1');
        }))));

  it('should force purge only specific form', testTask(({ Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get()))
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(true, 1))
          .then((message) => {
            message.should.equal('Forms purged: 1');
          })))));

  describe('with projectId', () => {
    it('should not purge recently deleted forms even if projectId is matched', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(null, null, 1))
          .then((message) => {
            message.should.equal('Forms purged: 0');
          }))));

    it('should not purge recently deleted forms even if projectId AND formId is matched', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(null, 1, 1))
          .then((message) => {
            message.should.equal('Forms purged: 0');
          }))));

    it('should purge specific form', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, 1, 1))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            })))));

    it('should not purge specific form if tied to a different project', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, 1, 2))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })))));

    it('should purge all forms if no form ID supplied', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, null, 1))
            .then((message) => {
              message.should.equal('Forms purged: 2');
            })))));

    it('should not purge multiple forms if tied to a different project', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, null, 2))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })))));
  });

  describe('with xmlFormId', () => {
    it('should throw error if xmlFormId specified without projectId', testTask(async ({ Forms }) => {
      const form = await Forms.getByProjectAndXmlFormId(1, 'simple');
      await Forms.del(form.get());
      await assert.throws(() => { purgeForms(true, null, null, 'simple'); }, (err) => {
        err.problemCode.should.equal(500.1);
        err.problemDetails.error.should.equal('Must also specify projectId when using xmlFormId');
        return true;
      });
    }));

    it('should force purge form by project and xmlFormId', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(true, null, 1, 'simple'))
          .then((message) => {
            message.should.equal('Forms purged: 1');
          }))));
    it('should not purge form by project and xmlFormId if form deleted recently and not forced', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(false, null, 1, 'simple'))
          .then((message) => {
            message.should.equal('Forms purged: 0');
          }))));
  });

});

