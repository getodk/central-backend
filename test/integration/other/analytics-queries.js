const appRoot = require('app-root-path');
const should = require('should');
const { createReadStream } = require('fs');
const { sql } = require('slonik');
const { testTask, testService, testContainer } = require('../setup');
const { User, Actor } = require(appRoot + '/lib/model/frames');
const { createAppUser, createPublicLink, createTestForm, createTestProject, createTestUser, submitToForm } = require('../../data/analytics');
const testData = require('../../data/xml');

// Utility
const simpleInstance = (newInstanceId) => testData.instances.simple.one
  .replace('one</instance', `${newInstanceId}</instance`);

const withSimpleIds = (deprecatedId, instanceId) => testData.instances.simple.one
  .replace('one</instance', `${instanceId}</instanceID><deprecatedID>${deprecatedId}</deprecated`);

describe.only('analytics task queries', () => {
  describe('general server metrics', () => {
    it('should count audit log entries', testContainer( async (container) => {
      // recent "now" audits
      await container.Audits.log(null, 'dummy.action', null, 'test audit details');
      await container.Audits.log(null, 'dummy.action', null, 'test audit details');
      // old audit
      await container.run(sql`insert into audits ("actorId", action, "acteeId", details, "loggedAt")
        values (null, 'dummy.action', null, null, '1999-1-1')`);
      res = await container.Analytics.auditLogs();
      res.recent.should.equal(2);
      res.total.should.equal(3);
    }));

    it('should count admins', testContainer( async (container) => {
      await createTestUser(container, 'A', 'admin', 1);
      await createTestUser(container, 'B', 'admin', 1, false); // no recent activity
      // a third admin exists already from fixtures: 'alice' but with no recent activity

      const res = await container.Analytics.countAdmins();
      res.recent.should.equal(1);
      res.total.should.equal(3);
    }));

    it('should count encrypted projects',  testService( async (service, container) => {
      // encrypted project that has recent activity
      const proj = await createTestProject(container, 'New Proj');
      const form = await createTestForm(container, testData.forms.simple, proj); 
      await submitToForm(service, 'alice', proj.id, form.xmlFormId, testData.instances.simple.one);
      await container.Projects.setManagedEncryption(proj, 'secretpassword', 'hint');
      // encrypted project with no recent activity
      const unusedProj = await createTestProject(container, 'Unused Proj');
      await container.Projects.setManagedEncryption(unusedProj, 'secretpassword', 'hint');
      // compute metrics
      const res = await container.Analytics.encryptedProjects();
      res.total.should.equal(2);
      res.recent.should.equal(1);
    }));

    it('should count the number of questions in the biggest form', testContainer( async ({ Analytics }) => {
      const res = await Analytics.biggestForm();
      // fixture form withrepeats has 4 questions plus meta/instanceID, which is included in this count
      res.should.equal(5);
    }));

    it('should get the database size', testContainer( async ({ Analytics }) => {
      const res = await Analytics.databaseSize();
      res.database_size.should.be.above(0); // Probably around 13 MB?
    }));

    it('should determine whether backups are enabled', testContainer( async ({ Analytics, Configs }) => {
      let res = await Analytics.backupsEnabled();
      res.backups_configured.should.equal(0);
      await Configs.set('backups.main', {detail: 'dummy'});
      res = await Analytics.backupsEnabled();
      res.backups_configured.should.equal(1);
    }));
  });

  describe('user metrics', () => {
    it('should calculate number of managers, viewers, and data collectors per project', testContainer( async (container) => {
      // default project has 1 manager already (bob)
      const proj = await createTestProject(container, 'New Proj');
      
      // users with recent activity
      await createTestUser(container, 'Manager1', 'manager', proj.id);
      await createTestUser(container, 'Viewer1', 'viewer', proj.id);
      await createTestUser(container, 'Viewer2', 'viewer', proj.id);
      await createTestUser(container, 'Collector1', 'formfill', proj.id);
      await createTestUser(container, 'Collector2', 'formfill', proj.id);
      await createTestUser(container, 'Collector3', 'formfill', proj.id);
      
      // users without recent activity
      await createTestUser(container, 'Collector4', 'formfill', proj.id, false);

      // compute metrics
      const res = await container.Analytics.countUsersPerRole();
      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id][row.system] = {recent: row.recent, total: row.total};
      }

      // default project
      projects['1'].manager.total.should.equal(1);
      projects['1'].manager.recent.should.equal(0);

      // new project
      projects[proj.id].manager.total.should.equal(1);
      projects[proj.id].manager.recent.should.equal(1);
      projects[proj.id].viewer.total.should.equal(2);
      projects[proj.id].viewer.recent.should.equal(2);
      projects[proj.id].formfill.total.should.equal(4);
      projects[proj.id].formfill.recent.should.equal(3);
    }));

    it('should calculate number of app user per project', testService( async (service, container) => {
      // an app user that will make a submission
      const token = await createAppUser(service, 1, 'simple');
      // another non-recent app user
      await createAppUser(service, 1, 'simple');
      // make a submission through that app user
      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);;
      // calculate metrics
      const res = await container.Analytics.countAppUsers();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(2);
      res[0].recent.should.equal(1);
    }));

    it('should calculate unique device ids per project', testService( async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one, 'device1');
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two, 'device2');
      // make all submissions so far in the distant past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.three, 'device3');
      const res = await container.Analytics.countDeviceIds();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(3);
      res[0].recent.should.equal(1);
    }));

    it('should calculate public links per project', testService( async (service, container) => {
      const proj = await createTestProject(container, 'New Proj');
      const form = await createTestForm(container, testData.forms.simple, proj); 

      const publicLink = await createPublicLink(service, proj.id, form.xmlFormId);
      await service.post(`/v1/key/${publicLink}/projects/${proj.id}/forms/${form.xmlFormId}/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // extra inactive link
      await createPublicLink(service, proj.id, form.xmlFormId);

      const res = await container.Analytics.countPublicLinks();
      res[0].projectId.should.equal(proj.id);
      res[0].total.should.equal(2);
      res[0].recent.should.equal(1);
    }));
  });

  describe('form metrics', () => {
    it('should calculate forms per project', testService( async (service, container) => {
      const proj = await createTestProject(container, 'New Proj');
      const form = await createTestForm(container, testData.forms.simple, proj); 
      await submitToForm(service, 'alice', proj.id, form.xmlFormId, testData.instances.simple.one);

      const res = await container.Analytics.countForms();
      
      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id] = {recent: row.recent, total: row.total};
      }

      projects['1'].total.should.equal(2);
      projects['1'].recent.should.equal(0);

      projects[proj.id].total.should.equal(1);
      projects[proj.id].recent.should.equal(1);
    }));

    it('should calculate forms with repeats', testService( async (service, container) => {
      const res = await container.Analytics.countFormsGeoRepeats();
      res[0].projectId.should.equal(1);
      res[0].repeat_total.should.equal(1);
      res[0].repeat_recent.should.equal(0);
    }));

    it('should calculate forms with audits', testService( async (service, container) => {
      const proj = await createTestProject(container, 'New Proj');
      const auditForm = await createTestForm(container, testData.forms.clientAudits, proj);
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/${proj.id}/submission`)
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
          .expect(201));
      const res = await container.Analytics.countFormsGeoRepeats();

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id] = {recent: row.audit_recent, total: row.audit_total};
      }

      projects['1'].total.should.equal(0);
      projects['1'].recent.should.equal(0);
      projects[proj.id].total.should.equal(1);
      projects[proj.id].recent.should.equal(1);
    }));

    it('should calculate forms with geospatial elements', testService( async (service, container) => {
      const res = await container.Analytics.countFormsGeoRepeats();
      res.should.equal('TODO')
    }));

    it('should count encrypted forms per project', testService( async (service, container) => {
      const res = await container.Analytics.countFormsEncrypted();
      res.should.equal('TODO')
    }));
  });

  describe('submission metrics', () => {
    it('should calculate submissions', testService( async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two);
      // make all submissions so far in the distant past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.three);
      const res = await container.Analytics.countSubmissions();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(3);
      res[0].recent.should.equal(1);
    }));

    it('should calculate submissions by review state', testService( async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('aaa'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/aaa')
          .send({ reviewState: 'approved' }));

      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('bbb'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/bbb')
          .send({ reviewState: 'rejected' }));


      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('ccc'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/ccc')
          .send({ reviewState: 'hasIssues' }));

      // make all submissions so far in the distant past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);

      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('ddd'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/ddd')
          .send({ reviewState: 'hasIssues' }));

      const res = await container.Analytics.countSubmissionReviewStates();
      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id][row.reviewState] = {recent: row.recent, total: row.total};
      }

      projects['1'].approved.recent.should.equal(0);
      projects['1'].approved.total.should.equal(1);
      projects['1'].rejected.recent.should.equal(0);
      projects['1'].rejected.total.should.equal(1);
      projects['1'].hasIssues.recent.should.equal(1);
      projects['1'].hasIssues.total.should.equal(2);
    }));

    it('should calculate submissions that have been edited', testService( async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(withSimpleIds('one', '111').replace('Alice', 'Alyssa')), { filename: 'data.xml' })
          .expect(201));

      // make all submissions (and their defs in this case) so far in the distant past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await container.all(sql`update submission_defs set "createdAt" = '1999-1-1' where true`);

      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two);
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(withSimpleIds('two', '222').replace('Bob', 'Barb')), { filename: 'data.xml' })
          .expect(201));
      const res = await container.Analytics.countSubmissionsEdited();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(2);
      res[0].recent.should.equal(1);
    }));

    it('should calculate submissions that have comments', testService( async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/forms/simple/submissions/one/comments`)
          .send({ body: 'new comment here' })
          .expect(200));
      // make all submissions so far in the past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two);
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/forms/simple/submissions/two/comments`)
          .send({ body: 'new comment here' })
          .expect(200));
      const res = await container.Analytics.countSubmissionsComments();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(2);
      res[0].recent.should.equal(1);
    }));

    it('should calculate submissions by user type', testService( async (service, container) => {
      // web user submission
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);

      // public link
      const publicLink = await createPublicLink(service, 1, 'simple');
      await service.post(`/v1/key/${publicLink}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('111'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      // app user token
      const token = await createAppUser(service, 1, 'simple');
      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('aaa'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('bbb'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      // make all submissions so far in the distant past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two);
      await submitToForm(service, 'bob', 1, 'simple', testData.instances.simple.three);

      await service.post(`/v1/key/${publicLink}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('222'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      const res = await container.Analytics.countSubmissionsByUserType();

      res[0].projectId.should.equal(1);
      res[0].web_user_total.should.equal(3);
      res[0].web_user_recent.should.equal(2);

      res[0].app_user_total.should.equal(2);
      res[0].app_user_recent.should.equal(0);

      res[0].pub_link_total.should.equal(2);
      res[0].pub_link_recent.should.equal(1)
    }));
  });
});

