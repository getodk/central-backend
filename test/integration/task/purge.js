const appRoot = require('app-root-path');
const assert = require('assert');
const { isEmpty } = require('ramda');
const { sql } = require('slonik');
const { testTask, testService } = require('../setup');
const { purgeForms } = require(appRoot + '/lib/task/purge');
const testData = require('../../data/xml');

// The basics of this task are tested here, including returning the count
// of purged forms, but the full functionality is more thoroughly tested in
// test/integration/other/form-purging.js

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
const testPurgeService = fn => testService((service, container) => fn(service, decorate(container)));

describe.only('task: purge deleted forms', () => {
  it('should not purge recently deleted forms by default', testPurgeTask(({ assertSoftDeleted, Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => assertSoftDeleted(1, 'simple')))
      .then(() => purgeForms())
      .then((count) => {
        count.should.equal(0);
      })
      .then(() => assertSoftDeleted(1, 'simple'))));

  it('should purge recently deleted form if forced', testPurgeTask(({ assertHardDeleted, assertSoftDeleted, Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => assertSoftDeleted(1, 'simple')))
      .then(() => purgeForms(true))
      .then((count) => {
        count.should.equal(1);
      })
      .then(() => assertHardDeleted(1, 'simple'))));

  it('should return count for multiple forms purged', testPurgeTask(({ assertHardDeleted, Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get()))
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
        .then((form) => Forms.del(form.get())))
      .then(() => purgeForms(true)
        .then((count) => {
          count.should.equal(2);
        })
        .then(() => assertHardDeleted(1, 'simple'))
        .then(() => assertHardDeleted(1, 'withrepeat')))));

  it('should not purge specific recently deleted form', testPurgeTask(({ assertSoftDeleted, Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(false, 1))
        .then((count) => {
          count.should.equal(0);
        })
        .then(() => assertSoftDeleted(1, 'simple')))));

  it('should purge specific recently deleted form if forced', testPurgeTask(({ assertHardDeleted, Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get())
        .then(() => purgeForms(true, 1))
        .then((count) => {
          count.should.equal(1);
        })
        .then(() => assertHardDeleted(1, 'simple')))));

  it('should force purge only specific form', testPurgeTask(({ assertHardDeleted, assertSoftDeleted, Forms }) =>
    Forms.getByProjectAndXmlFormId(1, 'simple')
      .then((form) => Forms.del(form.get()))
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(true, 1))
          .then((count) => {
            count.should.equal(1);
          })
          .then(() => assertHardDeleted(1, 'simple'))
          .then(() => assertSoftDeleted(1, 'withrepeat'))))));

  describe('with projectId', () => {
    it('should not purge recently deleted forms even if projectId is matched', testPurgeTask(({ assertSoftDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(null, null, 1))
          .then((count) => {
            count.should.equal(0);
          })
          .then(() => assertSoftDeleted(1, 'simple')))));

    it('should not purge recently deleted forms even if projectId AND formId is matched', testPurgeTask(({ assertSoftDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(null, 1, 1))
          .then((count) => {
            count.should.equal(0);
          })
          .then(() => assertSoftDeleted(1, 'simple')))));

    it('should purge specific form', testPurgeTask(({ assertHardDeleted, assertSoftDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, 1, 1))
            .then((count) => {
              count.should.equal(1);
            })
            .then(() => assertHardDeleted(1, 'simple'))
            .then(() => assertSoftDeleted(1, 'withrepeat'))))));

    it('should not purge specific form if tied to a different project', testPurgeTask(({ assertSoftDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, 1, 2))
            .then((count) => {
              count.should.equal(0);
            })
            .then(() => assertSoftDeleted(1, 'simple'))
            .then(() => assertSoftDeleted(1, 'withrepeat'))))));

    it('should purge all forms if no form ID supplied', testPurgeTask(({ assertHardDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, null, 1))
            .then((count) => {
              count.should.equal(2);
            })
            .then(() => assertHardDeleted(1, 'simple'))
            .then(() => assertHardDeleted(1, 'withrepeat'))))));

    it('should not purge multiple forms if tied to a different project', testPurgeTask(({ assertSoftDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get()))
        .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
          .then((form) => Forms.del(form.get())
            .then(() => purgeForms(true, null, 2))
            .then((count) => {
              count.should.equal(0);
            })
            .then(() => assertSoftDeleted(1, 'simple'))
            .then(() => assertSoftDeleted(1, 'withrepeat'))))));
  });

  describe('with xmlFormId', () => {
    it('should throw error if xmlFormId specified without projectId', testPurgeTask(async ({ assertSoftDeleted, Forms }) => {
      const form = await Forms.getByProjectAndXmlFormId(1, 'simple');
      await Forms.del(form.get());
      await assert.throws(() => { purgeForms(true, null, null, 'simple'); }, (err) => {
        err.problemCode.should.equal(500.1);
        err.problemDetails.error.should.equal('Must also specify projectId when using xmlFormId');
        return true;
      });
      await assertSoftDeleted(1, 'simple');
    }));

    it('should force purge form by project and xmlFormId', testPurgeTask(({ assertHardDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(true, null, 1, 'simple'))
          .then((count) => {
            count.should.equal(1);
          })
          .then(() => assertHardDeleted(1, 'simple')))));

    it('should not purge form by project and xmlFormId if form deleted recently and not forced', testPurgeTask(({ assertSoftDeleted, Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(false, null, 1, 'simple'))
          .then((count) => {
            count.should.equal(0);
          })
          .then(() => assertSoftDeleted(1, 'simple')))));

    it('should purge all versions of deleted form in project', testPurgeService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200);

      // new version (will be v2)
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.simple)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // publish new version v2
      await asAlice.post('/v1/projects/1/forms/simple/draft/publish?ignoreWarnings=true&version=v2')
        .expect(200);

      // delete new version v2
      await asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200);

      // new version (will be v3)
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.simple)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // publish new version v3 but don't delete
      await asAlice.post('/v1/projects/1/forms/simple/draft/publish?ignoreWarnings=true&version=v3')
        .expect(200);

      const count = await container.Forms.purge(true, null, 1, 'simple');
      count.should.equal(2);

      await container.assertNotDeleted(1, 'simple');
    }));

    it('should purge named form only from specified project', testPurgeService(async (service, container) => {
      const asAlice = await service.login('alice');

      // delete simple form in project 1 (but don't purge it)
      await asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200);

      const newProjectId = await asAlice.post('/v1/projects')
        .send({ name: 'Project Two' })
        .then(({ body }) => body.id);

      await asAlice.post(`/v1/projects/${newProjectId}/forms?publish=true`)
        .send(testData.forms.simple)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.delete(`/v1/projects/${newProjectId}/forms/simple`)
        .expect(200);

      const count = await container.Forms.purge(true, null, newProjectId, 'simple');
      count.should.equal(1);

      await container.assertSoftDeleted(1, 'simple');
      await container.assertHardDeleted(newProjectId, 'simple');
    }));
  });

});
