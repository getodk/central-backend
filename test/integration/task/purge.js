const appRoot = require('app-root-path');
const assert = require('assert');
const { isEmpty } = require('ramda');
const { sql } = require('slonik');
const { testTask } = require('../setup');
const { purgeTask } = require(appRoot + '/lib/task/purge');

// The basics of this task are tested here, including returning the message
// of purged forms, but the full functionality is more thoroughly tested in
// test/integration/other/form-purging.js and test/integration/other/submission-purging.js.

const decorate = container => {
  const getDbFormRow = (projectId, xmlFormName) => container.maybeOne(sql`
    SELECT * FROM forms WHERE "projectId"=${projectId} AND "xmlFormId"=${xmlFormName}
  `);
  const assertNotDeleted = async (projectId, xmlFormName) => {
    const maybeForm = await getDbFormRow(projectId, xmlFormName);
    assert.equal(isEmpty(maybeForm), false, 'Form has been hard-deleted or never existed.');
    const { deletedAt } = maybeForm.get();
    assert.equal(deletedAt, null, 'Form exists but has been marked as deleted.');
  };
  const assertSoftDeleted = async (projectId, xmlFormName) => {
    const maybeForm = await getDbFormRow(projectId, xmlFormName);
    assert.equal(isEmpty(maybeForm), false, 'Form has been hard-deleted or never existed.');
    const { deletedAt } = maybeForm.get();
    assert.ok(deletedAt, 'Form exists but has not been marked as deleted.');
  };
  const assertHardDeleted = async (projectId, xmlFormName) => {
    const maybeForm = await getDbFormRow(projectId, xmlFormName);
    assert.ok(isEmpty(maybeForm), 'Form should have been deleted, but still exists in DB!');
  };
  return { ...container, assertHardDeleted, assertNotDeleted, assertSoftDeleted };
};

const testPurgeTask = fn => testTask(container => fn(decorate(container)));

describe.only('task: purge deleted resources (forms and submissions)', () => {
  describe('forms', () => {
    describe('force flag', () => {
      it('should not purge recently deleted forms by default', testPurgeTask(({ assertSoftDeleted, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => assertSoftDeleted(1, 'simple')))
          .then(() => purgeTask({ mode: 'forms' }))
          .then((message) => {
            message.should.equal('Forms purged: 0');
          })
          .then(() => assertSoftDeleted(1, 'simple'))));

      it('should purge recently deleted form if forced', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: true }))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            }))));

      it('should return message for multiple forms purged', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())))
          .then(() => purgeTask({ mode: 'forms', force: true })
            .then((message) => {
              message.should.equal('Forms purged: 2');
            }))));
    });

    describe('form specified by formId', () => {
      it('should not purge specific recently deleted form', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: false, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            }))));

      it('should purge specific recently deleted form if forced', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: true, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            }))));

      it('should force purge only specific form', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 1');
              })))));
    });

    describe('form specified with projectId', () => {
      it('should not purge recently deleted forms even if projectId is matched (when not forced', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', projectId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            }))));

      it('should not purge recently deleted forms even if projectId AND formId is matched (when not forced)', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', projectId: 1, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            }))));

      it('should purge specific form', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 1');
              })))));

      it('should not purge specific form if tied to a different project', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 2, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 0');
              })))));

      it('should purge all forms in project if no form ID supplied', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 2');
              })))));

      it('should not purge multiple forms if tied to a different project', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 2 }))
              .then((message) => {
                message.should.equal('Forms purged: 0');
              })))));
    });

    describe('with xmlFormId', () => {
      it('should throw error if xmlFormId specified without projectId', testPurgeTask(async ({ Forms }) => {
        const form = await Forms.getByProjectAndXmlFormId(1, 'simple');
        await Forms.del(form.get());
        const message = await purgeTask({ mode: 'forms', force: true, xmlFormId: 'simple' });
        message.should.equal('Must also specify projectId when using xmlFormId');
      }));

      it('should force purge form by project and xmlFormId', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1, xmlFormId: 'simple' }))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            }))));

      it('should not purge form by project and xmlFormId if form deleted recently and not forced', testPurgeTask(({ Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: false, projectId: 1, xmlFormId: 'simple' }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            }))));
    });
  });

  describe('submissions', () => {
    // Can't set up more data in this task test setup but we can still test the function args
    it('should call submission purge if mode is specified as submissions', testPurgeTask(() =>
      purgeTask({ mode: 'submissions' })
        .then((message) => {
          message.should.equal('Submissions purged: 0');
        })));

    it('should call submission purge if submission instance id is specified', testPurgeTask(() =>
      purgeTask({ instanceId: 'abc', projectId: 1, xmlFormId: 'simple' })
        .then((message) => {
          message.should.equal('Submissions purged: 0');
        })));

    it('should complain if instance id specified without project and form', testPurgeTask(() =>
      purgeTask({ instanceId: 'abc' })
        .then((message) => {
          message.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        })));

    it('should complain if instance id specified without project', testPurgeTask(() =>
      purgeTask({ instanceId: 'abc', xmlFormId: 'simple' })
        .then((message) => {
          message.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        })));

    it('should complain if instance id specified without form', testPurgeTask(() =>
      purgeTask({ instanceId: 'abc', projectId: 1 })
        .then((message) => {
          message.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        })));
  });

  describe('all', () => {
    it('should purge both forms and submissions when neither mode is specified (not forced)', testPurgeTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask())
          .then((message) => {
            message.should.equal('Forms purged: 0, Submissions purged: 0');
          }))));

    it('should purge both forms and submissions when neither mode is specified (forced)', testPurgeTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask({ force: true }))
          .then((message) => {
            message.should.equal('Forms purged: 1, Submissions purged: 0');
          }))));

    it('should accept other mode and treat as "all"', testPurgeTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask({ force: true, mode: 'something_else' }))
          .then((message) => {
            message.should.equal('Forms purged: 1, Submissions purged: 0');
          }))));
  });
});

