const appRoot = require('app-root-path');
const assert = require('node:assert');
const { isEmpty } = require('ramda');
const { sql } = require('slonik');
const { testTask } = require('../setup');
const { purgeTask } = require(appRoot + '/lib/task/purge');

// The basics of this task are tested here, including returning the message
// of purged forms, but the full functionality is more thoroughly tested in
// test/integration/other/form-purging.js and test/integration/other/submission-purging.js.

const withDeleteChecks = container => {
  const confirm = {
    form: {},
    forms: {},
  };

  const getDbFormRow = (projectId, xmlFormName) => container.maybeOne(sql`
    SELECT * FROM forms WHERE "projectId"=${projectId} AND "xmlFormId"=${xmlFormName}
  `);

  confirm.forms.softDeleted = async expected => {
    const actual = await container.oneFirst(sql`SELECT COUNT(*) FROM forms WHERE "deletedAt" IS NOT NULL`);
    assert.equal(actual, expected);
  };

  confirm.form.softDeleted = async (projectId, xmlFormName) => {
    const maybeForm = await getDbFormRow(projectId, xmlFormName);
    assert.equal(isEmpty(maybeForm), false, 'Form has been hard-deleted or never existed.');
    const { deletedAt } = maybeForm.get();
    assert.ok(deletedAt, 'Form exists but has not been marked as deleted.');
  };

  confirm.form.hardDeleted = async (projectId, xmlFormName) => {
    const maybeForm = await getDbFormRow(projectId, xmlFormName);
    assert.ok(isEmpty(maybeForm), 'Form should have been deleted, but still exists in DB!');
  };

  return { ...container, confirm };
};

const testPurgeTask = fn => testTask(container => fn(withDeleteChecks(container)));

describe('task: purge deleted resources (forms and submissions)', () => {
  describe('forms', () => {
    describe('force flag', () => {
      it('should not purge recently deleted forms by default', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => confirm.form.softDeleted(1, 'simple')))
          .then(() => purgeTask({ mode: 'forms' }))
          .then((message) => {
            message.should.equal('Forms purged: 0');
          })
          .then(() => confirm.form.softDeleted(1, 'simple'))));

      it('should purge recently deleted form if forced', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => confirm.form.softDeleted(1, 'simple')))
          .then(() => purgeTask({ mode: 'forms', force: true }))
          .then((message) => {
            message.should.equal('Forms purged: 1');
          })
          .then(() => confirm.form.hardDeleted(1, 'simple'))));

      it('should return message for multiple forms purged', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())))
          .then(() => purgeTask({ mode: 'forms', force: true })
            .then((message) => {
              message.should.equal('Forms purged: 2');
            })
            .then(() => confirm.form.hardDeleted(1, 'simple'))
            .then(() => confirm.form.hardDeleted(1, 'withrepeat')))));
    });

    describe('form specified by formId', () => {
      it('should not purge specific recently deleted form', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: false, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })
            .then(() => confirm.form.softDeleted(1, 'simple')))));

      it('should purge specific recently deleted form if forced', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: true, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            })
            .then(() => confirm.form.hardDeleted(1, 'simple')))));

      it('should force purge only specific form', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 1');
              })
              .then(() => confirm.form.hardDeleted(1, 'simple'))
              .then(() => confirm.form.softDeleted(1, 'withrepeat'))))));
    });

    describe('form specified with projectId', () => {
      it('should not purge recently deleted forms even if projectId is matched (when not forced', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', projectId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })
            .then(() => confirm.form.softDeleted(1, 'simple')))));

      it('should not purge recently deleted forms even if projectId AND formId is matched (when not forced)', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', projectId: 1, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })
            .then(() => confirm.form.softDeleted(1, 'simple')))));

      it('should purge specific form', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 1');
              })
              .then(() => confirm.form.hardDeleted(1, 'simple'))
              .then(() => confirm.form.softDeleted(1, 'withrepeat'))))));

      it('should not purge specific form if tied to a different project', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 2, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 0');
              })
              .then(() => confirm.form.softDeleted(1, 'simple'))))));

      it('should purge all forms in project if no form ID supplied', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 2');
              })
              .then(() => confirm.form.hardDeleted(1, 'simple'))
              .then(() => confirm.form.hardDeleted(1, 'withrepeat'))))));

      it('should not purge multiple forms if tied to a different project', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 2 }))
              .then((message) => {
                message.should.equal('Forms purged: 0');
              })
              .then(() => confirm.forms.softDeleted(2))
              .then(() => confirm.form.softDeleted(1, 'simple'))
              .then(() => confirm.form.softDeleted(1, 'withrepeat'))))));
    });

    describe('with xmlFormId', () => {
      it('should throw error if xmlFormId specified without projectId', testPurgeTask(async ({ confirm, Forms }) => {
        const form = await Forms.getByProjectAndXmlFormId(1, 'simple');
        await Forms.del(form.get());
        const message = await purgeTask({ mode: 'forms', force: true, xmlFormId: 'simple' });
        message.should.equal('Must also specify projectId when using xmlFormId');
        await confirm.form.softDeleted(1, 'simple');
      }));

      it('should force purge form by project and xmlFormId', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1, xmlFormId: 'simple' }))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            })
            .then(() => confirm.form.hardDeleted(1, 'simple')))));

      it('should not purge form by project and xmlFormId if form deleted recently and not forced', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple')
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: false, projectId: 1, xmlFormId: 'simple' }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })
            .then(() => confirm.form.softDeleted(1, 'simple')))));
    });
  });

  describe('submissions', () => {
    // Can't set up more data in this task test setup but we can still test the function args
    it('should call submission purge if mode is specified as submissions', testTask(() =>
      purgeTask({ mode: 'submissions' })
        .then((message) => {
          message.should.equal('Submissions purged: 0');
        })));

    it('should call submission purge if submission instance id is specified', testTask(() =>
      purgeTask({ instanceId: 'abc', projectId: 1, xmlFormId: 'simple' })
        .then((message) => {
          message.should.equal('Submissions purged: 0');
        })));

    it('should complain if instance id specified without project and form', testTask(() =>
      purgeTask({ instanceId: 'abc' })
        .then((message) => {
          message.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        })));

    it('should complain if instance id specified without project', testTask(() =>
      purgeTask({ instanceId: 'abc', xmlFormId: 'simple' })
        .then((message) => {
          message.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        })));

    it('should complain if instance id specified without form', testTask(() =>
      purgeTask({ instanceId: 'abc', projectId: 1 })
        .then((message) => {
          message.should.equal('Must specify either all or none of projectId, xmlFormId, and instanceId');
        })));
  });

  describe('all', () => {
    it('should purge both forms and submissions when neither mode is specified (not forced)', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask())
          .then((message) => {
            message.should.equal('Forms purged: 0, Submissions purged: 0');
          }))));

    it('should purge both forms and submissions when neither mode is specified (forced)', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask({ force: true }))
          .then((message) => {
            message.should.equal('Forms purged: 1, Submissions purged: 0');
          }))));

    it('should accept other mode and treat as "all"', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask({ force: true, mode: 'something_else' }))
          .then((message) => {
            message.should.equal('Forms purged: 1, Submissions purged: 0');
          }))));
  });
});

