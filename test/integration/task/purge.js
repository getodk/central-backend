const appRoot = require('app-root-path');
const assert = require('assert');
const { testTask, testService } = require('../setup');
const { purgeForms } = require(appRoot + '/lib/task/purge');
const testData = require('../../data/xml');

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
      .then((form) => Forms.del(form.get()))
      .then(() => Forms.getByProjectAndXmlFormId(1, 'withrepeat')
        .then((form) => Forms.del(form.get())))
      .then(() => purgeForms(true)
        .then((count) => {
          count.should.equal(2);
        }))));

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

  describe('with xmlFormId', () => {
    it('should thow error if xmlFormId specified without projectId', testTask(async ({ Forms }) => {
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
          .then((count) => {
            count.should.equal(1);
          }))));
    it('should not purge form by project and xmlFormId if form deleted recently and not forced', testTask(({ Forms }) =>
      Forms.getByProjectAndXmlFormId(1, 'simple')
        .then((form) => Forms.del(form.get())
          .then(() => purgeForms(false, null, 1, 'simple'))
          .then((count) => {
            count.should.equal(0);
          }))));

    it('should purge all versions of deleted form in project', testService(async (service, container) => {
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
    }));

    it('should purged named form only from specified project', testService(async (service, container) => {
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
    }));
  });

});

