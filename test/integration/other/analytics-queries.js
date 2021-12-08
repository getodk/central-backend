const appRoot = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
const { testTask, testService, testContainer } = require('../setup');
const { Actor, Form, Project, Submission, User } = require(appRoot + '/lib/model/frames');
const { createReadStream } = require('fs');
const testData = require('../../data/xml');

const geoForm = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <h:head>
    <h:title>Simple Geo</h:title>
    <model odk:xforms-version="1">
      <instance>
        <data id="simple-geo">
          <location_gps/>
          <meta>
            <instanceID/>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/location_gps" type="geopoint"/>
      <bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
    </model>
  </h:head>
  <h:body>
    <input ref="/data/location_gps">
      <label>Location Position</label>
    </input>
  </h:body>
</h:html>`;

const geoSubmission = (instanceId) =>
  `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="simple-geo">
  <location_gps>20.96144 18.512518 0 0</location_gps>
  <meta>
    <instanceID>${instanceId}</instanceID>
  </meta>
</data>`;

// Utilities for making submissions
const simpleInstance = (newInstanceId) => testData.instances.simple.one
  .replace('one</instance', `${newInstanceId}</instance`);

const withSimpleIds = (deprecatedId, instanceId) => testData.instances.simple.one
  .replace('one</instance', `${instanceId}</instanceID><deprecatedID>${deprecatedId}</deprecated`);

// Utilities for creating things for tests
const createTestUser = (service, container, name, role, projectId, recent = true) =>
  service.login('alice', (asAlice) =>
    asAlice.post('/v1/users')
      .send({ email: `${name}@getodk.org`, password: name })
      .then(({ body }) => ((role === 'admin')
        ? asAlice.post(`/v1/assignments/admin/${body.id}`)
        : asAlice.post(`/v1/projects/${projectId}/assignments/${role}/${body.id}`))
        .then(() => (recent)
          ? container.Audits.log(body, 'dummy.action', null, 'a recent activity')
          : Promise.resolve())));

const createTestProject = (service, container, name) =>
  service.login('alice', (asAlice) =>
    asAlice.post('/v1/projects')
      .send({ name })
      .then(({ body }) => body.id));

const createTestForm = (service, container, xml, projectId) =>
  service.login('alice', (asAlice) =>
    asAlice.post(`/v1/projects/${projectId}/forms?publish=true`)
      .set('Content-Type', 'application/xml')
      .send(xml)
      .then(({ body }) => body.xmlFormId));

const createPublicLink = (service, projectId, xmlFormId) =>
  service.login('alice', (asAlice) =>
    asAlice.post(`/v1/projects/${projectId}/forms/${xmlFormId}/public-links`)
      .send({ displayName: 'test1' })
      .then(({ body }) => Promise.resolve(body.token)));

const createAppUser = (service, projectId, xmlFormId) =>
  service.login('alice', (asAlice) =>
    asAlice.post(`/v1/projects/${projectId}/app-users`)
      .send({ displayName: 'test1' })
      .then(({ body }) => body)
      .then((fk) => asAlice.post(`/v1/projects/${projectId}/forms/${xmlFormId}/assignments/app-user/${fk.id}`)
        .then(() => Promise.resolve(fk.token))));

const submitToForm = (service, user, projectId, xmlFormId, xml, deviceId = 'abcd') =>
  service.login(user, (asUser) =>
    asUser.post(`/v1/projects/${projectId}/forms/${xmlFormId}/submissions?deviceID=${deviceId}`)
      .send(xml)
      .set('Content-Type', 'text/xml')
      .expect(200));


////////////////////////////////////////////////////////////////////////////////
// Tests!
////////////////////////////////////////////////////////////////////////////////
describe('analytics task queries', () => {
  describe('general server metrics', () => {
    it('should count audit log entries', testContainer(async (container) => {
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

    it('should count admins', testService(async (service, container) => {
      await createTestUser(service, container, 'annie', 'admin', 1);
      await createTestUser(service, container, 'betty', 'admin', 1, false); // no recent activity
      await createTestUser(service, container, 'carly', 'admin', 1, false); // no recent activity
      // another admin exists already from fixtures: 'alice', who should have recent activity from logging the others in

      const res = await container.Analytics.countAdmins();
      res.recent.should.equal(2);
      res.total.should.equal(4);
    }));

    it('should count encrypted projects',  testService(async (service, container) => {
      // encrypted project that has recent activity
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);

      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/key`)
          .send({ passphrase: 'supersecret', hint: 'it is a secret' }));

      // encrypted project with no recent activity
      const unusedProjId = await createTestProject(service, container, 'Unused Proj');
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/${unusedProjId}/key`)
          .send({ passphrase: 'supersecret', hint: 'it is a secret' }));

      // compute metrics
      const res = await container.Analytics.encryptedProjects();
      res.total.should.equal(2);
      res.recent.should.equal(1);
    }));

    it('should count the number of questions in the biggest form', testContainer(async ({ Analytics }) => {
      const res = await Analytics.biggestForm();
      // fixture form withrepeats has 4 questions plus meta/instanceID, which is included in this count
      res.should.equal(5);
    }));

    it('should get the database size', testContainer(async ({ Analytics }) => {
      const res = await Analytics.databaseSize();
      res.database_size.should.be.above(0); // Probably around 13 MB?
    }));

    it('should determine whether backups are enabled', testContainer(async ({ Analytics, Configs }) => {
      let res = await Analytics.backupsEnabled();
      res.backups_configured.should.equal(0);
      await Configs.set('backups.main', {detail: 'dummy'});
      res = await Analytics.backupsEnabled();
      res.backups_configured.should.equal(1);
    }));
  });

  describe('user metrics', () => {
    it('should calculate number of managers per project', testService(async (service, container) => {
      // default project has 1 manager already (bob) with no activity
      await createTestUser(service, container, 'Manager1', 'manager', 1);
      
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

      projects['1'].manager.total.should.equal(2);
      projects['1'].manager.recent.should.equal(1);
    }));

    it('should calculate number of viewers per project', testService(async (service, container) => {
      // users with recent activity
      await createTestUser(service, container, 'Viewer1', 'viewer', 1);
      await createTestUser(service, container, 'Viewer2', 'viewer', 1, false); // user without recent activity

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

      projects['1'].viewer.total.should.equal(2);
      projects['1'].viewer.recent.should.equal(1);
    }));

    it('should calculate number of data collectors per project', testService(async (service, container) => {
      // users with recent activity
      await createTestUser(service, container, 'Collector1', 'formfill', 1);
      await createTestUser(service, container, 'Collector2', 'formfill', 1, false); // user without recent activity

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

      projects['1'].formfill.total.should.equal(2);
      projects['1'].formfill.recent.should.equal(1);
    }));

    it('should calculate number of app user per project', testService(async (service, container) => {
      // an app user that will make a submission
      const token = await createAppUser(service, 1, 'simple');
      // another non-recent app user
      await createAppUser(service, 1, 'simple');
      // make a submission through that app user
      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml');

      // calculate metrics
      const res = await container.Analytics.countAppUsers();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(2);
      res[0].recent.should.equal(1);
    }));

    it('should calculate unique device ids per project', testService(async (service, container) => {
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

    it('should calculate public links per project', testService(async (service, container) => {
      const publicLink = await createPublicLink(service, 1, 'simple');
      await service.post(`/v1/key/${publicLink}/projects/1/forms/simple/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml');

      // extra inactive link
      await createPublicLink(service, 1, 'simple');

      const res = await container.Analytics.countPublicLinks();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(2);
      res[0].recent.should.equal(1);
    }));
  });

  describe('form metrics', () => {
    it('should calculate forms per project', testService(async (service, container) => {
      const projId = await createTestProject(service, container, 'New Proj');
      const xmlFormId = await createTestForm(service, container, testData.forms.simple, projId);
      await submitToForm(service, 'alice', projId, xmlFormId, testData.instances.simple.one);

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

      projects[projId].total.should.equal(1);
      projects[projId].recent.should.equal(1);
    }));

    it('should calculate forms with repeats', testService(async (service, container) => {
      const res = await container.Analytics.countFormFieldTypes();
      res[0].projectId.should.equal(1);
      res[0].repeat_total.should.equal(1);
      res[0].repeat_recent.should.equal(0);
    }));

    it('should calculate forms with audits', testService(async (service, container) => {
      const projId = await createTestProject(service, container, 'New Proj');
      await createTestForm(service, container, testData.forms.clientAudits, projId);
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/${projId}/submission`)
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' }));

      const res = await container.Analytics.countFormFieldTypes();
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
      projects[projId].total.should.equal(1);
      projects[projId].recent.should.equal(1);
    }));

    it('should calculate forms with geospatial elements', testService(async (service, container) => {
      const xmlFormId = await createTestForm(service, container, geoForm, 1);
      await submitToForm(service, 'alice', 1, xmlFormId, geoSubmission('one'));
      const res = await container.Analytics.countFormFieldTypes();

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id] = {recent: row.geo_recent, total: row.geo_total};
      }

      projects['1'].total.should.equal(1);
      projects['1'].recent.should.equal(1);
    }));

    it('should count encrypted forms per project', testService(async (service, container) => {
      const projId = await createTestProject(service, container, 'New Proj');
      const encryptedFormId = await createTestForm(service, container, testData.forms.encrypted, projId);
      await submitToForm(service, 'alice', projId, encryptedFormId, testData.instances.encrypted.one);
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      const res = await container.Analytics.countFormsEncrypted();
      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id] = {recent: row.recent, total: row.total};
      }

      projects['1'].total.should.equal(0);
      projects['1'].recent.should.equal(0);
      projects[projId].total.should.equal(1);
      projects[projId].recent.should.equal(0);
    }));
  });

  describe('submission metrics', () => {
    it('should calculate submissions', testService(async (service, container) => {
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

    it('should calculate submissions by review state: approved', testService(async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('aaa'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/aaa')
          .send({ reviewState: 'approved' }));

      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);

      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('bbb'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/bbb')
          .send({ reviewState: 'approved' }));

      const res = await container.Analytics.countSubmissionReviewStates();

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id][row.reviewState] = {recent: row.recent, total: row.total};
      }

      projects['1'].approved.recent.should.equal(1);
      projects['1'].approved.total.should.equal(2);
    }));


    it('should calculate submissions by review state: rejected', testService(async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('aaa'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/aaa')
          .send({ reviewState: 'rejected' }));

      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);

      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('bbb'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/bbb')
          .send({ reviewState: 'rejected' }));

      const res = await container.Analytics.countSubmissionReviewStates();

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id][row.reviewState] = {recent: row.recent, total: row.total};
      }

      projects['1'].rejected.recent.should.equal(1);
      projects['1'].rejected.total.should.equal(2);
    }));

    it('should calculate submissions by review state: hasIssues', testService(async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('aaa'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/aaa')
          .send({ reviewState: 'hasIssues' }));

      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);

      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('bbb'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/bbb')
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

      projects['1'].hasIssues.recent.should.equal(1);
      projects['1'].hasIssues.total.should.equal(2);
    }));

    it('should calculate submissions by review state: edited', testService(async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('aaa'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/aaa')
          .send({ reviewState: 'edited' }));

      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);

      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('bbb'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/bbb')
          .send({ reviewState: 'edited' }));

      const res = await container.Analytics.countSubmissionReviewStates();

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        projects[id][row.reviewState] = {recent: row.recent, total: row.total};
      }

      projects['1'].edited.recent.should.equal(1);
      projects['1'].edited.total.should.equal(2);
    }));

    it('should calculate submissions that have been edited', testService(async (service, container) => {
      // submissions can be edited (have new versions) while the review state is something else
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(withSimpleIds('one', '111').replace('Alice', 'Alyssa')), { filename: 'data.xml' }));

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

    it('should calculate submissions that have comments', testService(async (service, container) => {
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/forms/simple/submissions/one/comments`)
          .send({ body: 'new comment here' }));

      // make all submissions so far in the past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two);
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/forms/simple/submissions/two/comments`)
          .send({ body: 'new comment here' }));

      const res = await container.Analytics.countSubmissionsComments();
      res[0].projectId.should.equal(1);
      res[0].total.should.equal(2);
      res[0].recent.should.equal(1);
    }));

    it('should calculate submissions by user type', testService(async (service, container) => {
      // web user submission
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);

      // public link
      const publicLink = await createPublicLink(service, 1, 'simple');
      await service.post(`/v1/key/${publicLink}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('111'))
        .set('Content-Type', 'application/xml');

      // app user token
      const token = await createAppUser(service, 1, 'simple');
      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('aaa'))
        .set('Content-Type', 'application/xml');

      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('bbb'))
        .set('Content-Type', 'application/xml');

      // make all submissions so far in the distant past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two);
      await submitToForm(service, 'bob', 1, 'simple', testData.instances.simple.three);

      await service.post(`/v1/key/${publicLink}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('222'))
        .set('Content-Type', 'application/xml');

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

  describe('combined analytics', function() {
    // increasing timeouts on this set of tests
    this.timeout(4000);

    it('should combine system level queries', testService(async (service, container) => {
      // backups
      await container.Configs.set('backups.main', {detail: 'dummy'});

      // encrypting a project
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/key`)
          .send({ passphrase: 'supersecret', hint: 'it is a secret' }));

      const res = await container.Analytics.previewMetrics();

      // everything in system filled in
      res.system.num_admins.total.should.equal(1);
      res.system.num_projects_encryption.total.should.equal(1);
      res.system.num_questions_biggest_form.should.equal(5);
      res.system.num_audit_log_entries.total.should.be.above(0);
      res.system.backups_configured.should.equal(1);
      res.system.database_size.should.be.above(0);
    }));

    it('should fill in all project.users queries', testService(async (service, container) => {
      // create more users
      await createTestUser(service, container, 'Collector1', 'formfill', 1, false);
      await createTestUser(service, container, 'Viewer1', 'viewer', 1, false); // no recent activity

      // submission with device id
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one, 'device1');

      // create app users
      const token = await createAppUser(service, 1, 'simple');
      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('app_user_token'))
        .set('Content-Type', 'application/xml');

      // public links
      const publicLink = await createPublicLink(service, 1, 'simple');
      await service.post(`/v1/key/${publicLink}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('pub_link'))
        .set('Content-Type', 'application/xml');

      const res = await container.Analytics.previewMetrics();

      // check everything is non-zero
      Object.values(res.projects[0].users).forEach((metric) => metric.total.should.be.above(0));
    }));

    it('should fill in all project.forms queries', testService(async (service, container) => {
      // geospatial form
      await createTestForm(service, container, geoForm, 1);

      // encrypted form
      await createTestForm(service, container, testData.forms.encrypted, 1);

      // form with audit
      await createTestForm(service, container, testData.forms.clientAudits, 1);
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/submission`)
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' }));

      const res = await container.Analytics.previewMetrics();

      // check everything is non-zero
      Object.values(res.projects[0].forms).forEach((metric) => metric.total.should.be.above(0));
    }));

    it('should fill in all project.submissions queries', testService(async (service, container) => {
     // submission states
      for (const state of ['approved', 'rejected', 'hasIssues', 'edited']) {
        await submitToForm(service, 'alice', 1, 'simple', simpleInstance(state));
        await service.login('alice', (asAlice) =>
          asAlice.patch(`/v1/projects/1/forms/simple/submissions/${state}`)
            .send({ reviewState: state }));
      }

      // with edits
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('v1'));
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/submission`)
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(withSimpleIds('v1', 'v2').replace('Alice', 'Alyssa')), { filename: 'data.xml' }));

      // comments
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one, 'device1');
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/forms/simple/submissions/one/comments`)
          .send({ body: 'new comment here' }));

      // public link
      const publicLink = await createPublicLink(service, 1, 'simple');
      await service.post(`/v1/key/${publicLink}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('111'))
        .set('Content-Type', 'application/xml');

      // app user token
      const token = await createAppUser(service, 1, 'simple');
      await service.post(`/v1/key/${token}/projects/1/forms/simple/submissions`)
        .send(simpleInstance('aaa'))
        .set('Content-Type', 'application/xml');

      const res = await container.Analytics.previewMetrics();

      // check everything is non-zero
      Object.values(res.projects[0].submissions).forEach((metric) => metric.total.should.be.above(0));
    }));

    it('should be idempotent and not cross-polute project counts', testService(async (service, container) => {
      const proj1 = await createTestProject(service, container, 'New Proj 1');
      const formId1 = await createTestForm(service, container, testData.forms.simple, proj1);

      // approved submission in original project
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('aaa'));
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/aaa')
          .send({ reviewState: 'approved' }));

      // rejected submission in new project
      await submitToForm(service, 'alice', proj1, 'simple', simpleInstance('aaa'));
      await service.login('alice', (asAlice) =>
        asAlice.patch(`/v1/projects/${proj1}/forms/simple/submissions/aaa`)
          .send({ reviewState: 'rejected' }));

      let res = await container.Analytics.previewMetrics();
      res.projects[1].submissions.num_submissions_approved.total.should.equal(0);

      // there used to be a bug where counts from one project could
      // pollute another project.
      res = await container.Analytics.previewMetrics();
      res.projects[1].submissions.num_submissions_approved.total.should.equal(0);
    }));
  });

  describe('latest analytics audit log utility', () => {
    it('should find recently created analytics audit log', testService(async (service, container) => {
      await container.Audits.log(null, 'analytics', null, {test: 'foo', success: true});
      const res = await container.Analytics.getLatestAudit().then((o) => o.get());
      res.details.test.should.equal('foo');
    }));

    it('should find nothing if no recent analytics audit log', testService(async (service, container) => {
      // make all submissions so far in the distant past
      //await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      const res = await container.Analytics.getLatestAudit();
      res.isEmpty().should.equal(true);
    }));

    it('should not return analytics audit log more than 30 days prior', testService(async (service, container) => {
      await container.Audits.log(null, 'analytics', null, {test: 'foo', success: true});
      // make all analytics audits so far in the distant past
      await container.all(sql`update audits set "loggedAt" = '1999-1-1' where action = 'analytics'`);
      const res = await container.Analytics.getLatestAudit();
      res.isEmpty().should.equal(true);
    }));
  });
});

