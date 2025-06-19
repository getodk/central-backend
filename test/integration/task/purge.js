const crypto = require('node:crypto');
const appRoot = require('app-root-path');
const assert = require('node:assert');
const { isEmpty } = require('ramda');
const { sql } = require('slonik');
const { testTask } = require('../setup');
const { purgeTask } = require(appRoot + '/lib/task/purge');
const { Blob } = require(appRoot + '/lib/model/frames');
const Problem = require(appRoot + '/lib/util/problem');

// The basics of this task are tested here, including returning the message
// of purged forms, but the full functionality is more thoroughly tested in
// test/integration/other/form-purging.js,
// test/integration/other/submission-purging.js and
// test/integration/other/entities-purging.js

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

describe('task: purge deleted resources (forms, submissions and entities)', () => {
  describe('forms', () => {
    describe('force flag', () => {
      it('should not purge recently deleted forms by default', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get())
            .then(() => confirm.form.softDeleted(1, 'simple')))
          .then(() => purgeTask({ mode: 'forms' }))
          .then((message) => {
            message.should.equal('Forms purged: 0');
          })
          .then(() => confirm.form.softDeleted(1, 'simple'))));

      it('should purge recently deleted form if forced', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get())
            .then(() => confirm.form.softDeleted(1, 'simple')))
          .then(() => purgeTask({ mode: 'forms', force: true }))
          .then((message) => {
            message.should.equal('Forms purged: 1');
          })
          .then(() => confirm.form.hardDeleted(1, 'simple'))));

      it('should return message for multiple forms purged', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat', false, Form.NoDefRequired)
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
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: false, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })
            .then(() => confirm.form.softDeleted(1, 'simple')))));

      it('should purge specific recently deleted form if forced', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: true, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            })
            .then(() => confirm.form.hardDeleted(1, 'simple')))));

      it('should force purge only specific form', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat', false, Form.NoDefRequired)
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
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', projectId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })
            .then(() => confirm.form.softDeleted(1, 'simple')))));

      it('should not purge recently deleted forms even if projectId AND formId is matched (when not forced)', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', projectId: 1, formId: 1 }))
            .then((message) => {
              message.should.equal('Forms purged: 0');
            })
            .then(() => confirm.form.softDeleted(1, 'simple')))));

      it('should purge specific form', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat', false, Form.NoDefRequired)
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 1');
              })
              .then(() => confirm.form.hardDeleted(1, 'simple'))
              .then(() => confirm.form.softDeleted(1, 'withrepeat'))))));

      it('should not purge specific form if tied to a different project', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat', false, Form.NoDefRequired)
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 2, formId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 0');
              })
              .then(() => confirm.form.softDeleted(1, 'simple'))))));

      it('should purge all forms in project if no form ID supplied', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat', false, Form.NoDefRequired)
            .then((form) => Forms.del(form.get())
              .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1 }))
              .then((message) => {
                message.should.equal('Forms purged: 2');
              })
              .then(() => confirm.form.hardDeleted(1, 'simple'))
              .then(() => confirm.form.hardDeleted(1, 'withrepeat'))))));

      it('should not purge multiple forms if tied to a different project', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get()))
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat', false, Form.NoDefRequired)
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
        const form = await Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired);
        await Forms.del(form.get());
        await purgeTask({ mode: 'forms', force: true, xmlFormId: 'simple' }).should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must also specify projectId when using xmlFormId',
          },
        });
        await confirm.form.softDeleted(1, 'simple');
      }));

      it('should force purge form by project and xmlFormId', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
          .then((form) => Forms.del(form.get())
            .then(() => purgeTask({ mode: 'forms', force: true, projectId: 1, xmlFormId: 'simple' }))
            .then((message) => {
              message.should.equal('Forms purged: 1');
            })
            .then(() => confirm.form.hardDeleted(1, 'simple')))));

      it('should not purge form by project and xmlFormId if form deleted recently and not forced', testPurgeTask(({ confirm, Forms }) =>
        Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
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
        .should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must specify either all or none of projectId, xmlFormId, and instanceId',
          },
        })));

    it('should complain if instance id specified without project', testTask(() =>
      purgeTask({ instanceId: 'abc', xmlFormId: 'simple' })
        .should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must specify either all or none of projectId, xmlFormId, and instanceId',
          },
        })));

    it('should complain if instance id specified without form', testTask(() =>
      purgeTask({ instanceId: 'abc', projectId: 1 })
        .should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must specify either all or none of projectId, xmlFormId, and instanceId',
          },
        })));
  });

  describe('entities', () => {
    it('should call entities purge if mode is specified as entities', testTask(() =>
      purgeTask({ mode: 'entities' })
        .then((message) => {
          message.should.equal('Entities purged: 0');
        })));

    it('should call entities purge if entities uuid is specified', testTask(() =>
      purgeTask({ entityUuid: 'abc', projectId: 1, datasetName: 'people' })
        .then((message) => {
          message.should.equal('Entities purged: 0');
        })));

    it('should call entities purge if dataset name is specified', testTask(() =>
      purgeTask({ projectId: 1, datasetName: 'people' })
        .then((message) => {
          message.should.equal('Entities purged: 0');
        })));

    it('should complain if uuid specified without project and dataset', testTask(() =>
      purgeTask({ entityUuid: 'abc' })
        .should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must specify projectId and datasetName to purge a specify entity.',
          },
        })));

    it('should complain if uuid specified without project', testTask(() =>
      purgeTask({ entityUuid: 'abc', datasetName: 'simple' })
        .should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must specify projectId and datasetName to purge a specify entity.',
          },
        })));

    it('should complain if uuid specified without dataset', testTask(() =>
      purgeTask({ entityUuid: 'abc', projectId: 1 })
        .should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must specify projectId and datasetName to purge a specify entity.',
          },
        })));

    it('should complain if dataset specified without project', testTask(() =>
      purgeTask({ datasetName: 'simple' })
        .should.be.rejectedWith(Problem, {
          problemDetails: {
            error: 'Must specify projectId to purge all entities of a dataset/entity-list.',
          },
        })));
  });

  describe('all', () => {
    it('should purge both forms and submissions when neither mode is specified (not forced)', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask())
          .then((message) => {
            message.should.equal('Forms purged: 0, Submissions purged: 0, Entities purged: 0');
          }))));

    it('should purge both forms and submissions when neither mode is specified (forced)', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask({ force: true }))
          .then((message) => {
            message.should.equal('Forms purged: 1, Submissions purged: 0, Entities purged: 0');
          }))));

    it('should accept other mode and treat as "all"', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple', false, Form.NoDefRequired)
        .then((form) => Forms.del(form.get())
          .then(() => purgeTask({ force: true, mode: 'something_else' }))
          .then((message) => {
            message.should.equal('Forms purged: 1, Submissions purged: 0, Entities purged: 0');
          }))));
  });

  describe('with s3 blob storage', () => {
    // The Postgres query planner can end up doing some crazy things when trying
    // to identify unattached blobs.  This test seems to expose that behaviour,
    // although real-world performance will still need to be monitored.
    //
    // See: https://github.com/getodk/central-backend/issues/1443

    beforeEach(() => {
      global.s3.enableMock();
    });

    it('should purge in a reasonable amount of time @slow', testTask(async function({ all }) {
      // On a dev laptop, the following measurements were made:
      //
      // legacy implementation:   25s
      // current implementation: 2.5s

      this.timeout(5_000);

      // given
      const blobs = [];
      for (let i=0; i<10_000; ++i) { // eslint-disable-line no-plusplus
        const blob = Blob.fromBuffer(crypto.randomBytes(100));
        const { sha, md5 } = blob;
        blobs.push({ sha, md5, content: null, contentType: 'text/plain', s3_status: 'uploaded' });
      }
      const dbBlobs = await all(sql`
        INSERT INTO blobs (sha, md5, content, "contentType", s3_status)
          SELECT sha, md5, content, "contentType", s3_status
            FROM JSON_POPULATE_RECORDSET(NULL::blobs, ${JSON.stringify(blobs)})
          RETURNING id, sha
      `);
      global.s3.mockExistingBlobs(dbBlobs);

      // when
      await purgeTask({ mode: 'forms', force: false, formId: 1 });

      // then
      // it has not timed out or thrown
    }));
  });

});

