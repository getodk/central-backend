const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testService, testContainer } = require('../setup');
const { createReadStream } = require('fs');
const testData = require('../../data/xml');
const { identity } = require('ramda');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');

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
      .send({ email: `${name}@getodk.org`, password: `${name}slongpassword` }) // password has to be >10 chars
      .then(({ body }) => ((role === 'admin')
        ? asAlice.post(`/v1/assignments/admin/${body.id}`)
        : asAlice.post(`/v1/projects/${projectId}/assignments/${role}/${body.id}`))
        // eslint-disable-next-line no-confusing-arrow
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
      const res = await container.Analytics.auditLogs();
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

    // eslint-disable-next-line no-multi-spaces
    it('should count encrypted projects', testService(async (service, container) => {
      // encrypted project that has recent activity
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one);

      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
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

    it('should count the number of unique roles across projects', testService(async (service, container) => {
      // managers, viewers, data collectors
      // bob is a manager on original project 1
      // dana is a viewer on proj 1 and proj 2 (only gets counted once)
      // emmy is a data collector on proj 2 and a viewer on proj 3
      //  (gets counted once for each role)

      const proj2 = await createTestProject(service, container, 'An extra project');
      const proj3 = await createTestProject(service, container, 'Another extra project');

      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'dana@getodk.org' })
          .then(({ body }) =>
            asAlice.post(`/v1/projects/1/assignments/viewer/${body.id}`)
              .expect(200)
              .then(() => asAlice.post(`/v1/projects/${proj2}/assignments/viewer/${body.id}`)
                .expect(200)))
          .then(() => asAlice.post('/v1/users')
            .send({ email: 'emmy@getodk.org' })
            .then(({ body }) =>
              asAlice.post(`/v1/projects/${proj2}/assignments/formfill/${body.id}`)
                .expect(200)
                .then(() => asAlice.post(`/v1/projects/${proj3}/assignments/viewer/${body.id}`)
                  .expect(200)))));

      const managers = await container.Analytics.countUniqueManagers();
      const viewers = await container.Analytics.countUniqueViewers();
      const collectors = await container.Analytics.countUniqueDataCollectors();
      managers.should.equal(1);
      viewers.should.equal(2);
      collectors.should.equal(1);
    }));

    it('should count the number archived projects', testService(async (service, { Analytics }) => {
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ archived: true })
          .expect(200));
      const res = await Analytics.archivedProjects();
      res.num_archived_projects.should.equal(1);
    }));

    it('should get the database size', testContainer(async ({ Analytics }) => {
      const res = await Analytics.databaseSize();
      res.database_size.should.be.above(0); // Probably around 13 MB?
    }));

    it('should determine whether backups are enabled', testContainer(async ({ Analytics, Configs }) => {
      let res = await Analytics.backupsEnabled();
      res.backups_configured.should.equal(0);
      // eslint-disable-next-line object-curly-spacing
      await Configs.set('backups.main', { detail: 'dummy' });
      res = await Analytics.backupsEnabled();
      res.backups_configured.should.equal(1);
    }));

    it('should check database configurations', testContainer(async ({ Analytics }) => {
      // only localhost (dev) and postgres (docker) should count as not external
      Analytics.databaseExternal('localhost').should.equal(0);
      Analytics.databaseExternal('postgres').should.equal(0);
      Analytics.databaseExternal('blah.stuff.com').should.equal(1);
      Analytics.databaseExternal('').should.equal(1);
      Analytics.databaseExternal('localhost-not').should.equal(1);
      Analytics.databaseExternal('not-localhost').should.equal(1);
      Analytics.databaseExternal(undefined).should.equal(1);
      Analytics.databaseExternal(null).should.equal(1);
    }));
  });

  describe('user metrics', () => {
    it('should calculate number of managers per project', testService(async (service, container) => {
      // default project has 1 manager already (bob) with no activity
      await createTestUser(service, container, 'Manager1', 'manager', 1);
      // eslint-disable-next-line no-trailing-spaces

      // compute metrics
      const res = await container.Analytics.countUsersPerRole();

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        // eslint-disable-next-line object-curly-spacing
        projects[id][row.system] = { recent: row.recent, total: row.total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id][row.system] = { recent: row.recent, total: row.total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id][row.system] = { recent: row.recent, total: row.total };
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
      // eslint-disable-next-line no-trailing-spaces

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        if (!(id in projects)) {
          projects[id] = {};
        }
        // eslint-disable-next-line object-curly-spacing
        projects[id] = { recent: row.recent, total: row.total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id] = { recent: row.audit_recent, total: row.audit_total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id] = { recent: row.geo_recent, total: row.geo_total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id] = { recent: row.recent, total: row.total };
      }

      projects['1'].total.should.equal(0);
      projects['1'].recent.should.equal(0);
      projects[projId].total.should.equal(1);
      projects[projId].recent.should.equal(0);
    }));

    it('should calculate forms in each form state per project', testService(async (service, container) => {
      const projId = await createTestProject(service, container, 'New Proj');
      const xmlFormId = await createTestForm(service, container, testData.forms.simple, projId);
      await submitToForm(service, 'alice', projId, xmlFormId, testData.instances.simple.one);

      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.patch(`/v1/projects/${projId}/forms/simple`)
            .send({ state: 'closing' })
            .expect(200)));

      const res = await container.Analytics.countFormsInStates();

      const projects = {};
      for (const row of res) {
        const id = row.projectId;
        const { state } = row;
        if (!(id in projects)) {
          projects[id] = {};
        }
        if (!(state in projects[id])) {
          projects[id][state] = { recent: row.recent, total: row.total };
        }
      }

      projects['1'].should.eql({ closed: { recent: 0, total: 1 }, open: { recent: 0, total: 1 } });
      projects[projId].should.eql({ closing: { recent: 1, total: 1 } });
    }));

    it('should calculate number of forms reusing ids of deleted forms', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200));

      // no deleted forms reused yet
      const emptyRes = await container.Analytics.countReusedFormIds();
      emptyRes.should.eql([]);

      // one purged form reused
      await container.Forms.purge(true);
      await createTestForm(service, container, testData.forms.simple, 1);

      // one deleted unpublished form reused (in the same project)
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.delete('/v1/projects/1/forms/simple2'))
          .then(() => asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')));

      // delete multiple times (only count 1 active form with reused id)
      const proj2 = await createTestProject(service, container, 'New Proj');
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/${proj2}/forms`)
          .send(testData.forms.simple)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.delete(`/v1/projects/${proj2}/forms/simple`))
          .then(() => asAlice.post(`/v1/projects/${proj2}/forms?publish=true`)
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml'))
          .then(() => asAlice.delete(`/v1/projects/${proj2}/forms/simple`))
          .then(() => asAlice.post(`/v1/projects/${proj2}/forms?publish=true`)
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="three"'))
            .set('Content-Type', 'application/xml')));

      const res = await container.Analytics.countReusedFormIds();
      res.should.eql([
        { projectId: 1, total: 2 },
        { projectId: proj2, total: 1 }
      ]);
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
        // eslint-disable-next-line object-curly-spacing
        projects[id][row.reviewState] = { recent: row.recent, total: row.total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id][row.reviewState] = { recent: row.recent, total: row.total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id][row.reviewState] = { recent: row.recent, total: row.total };
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
        // eslint-disable-next-line object-curly-spacing
        projects[id][row.reviewState] = { recent: row.recent, total: row.total };
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
        asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
          .send({ body: 'new comment here' }));

      // make all submissions so far in the past
      await container.all(sql`update submissions set "createdAt" = '1999-1-1' where true`);
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.two);
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions/two/comments')
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
      res[0].pub_link_recent.should.equal(1);
    }));
  });

  describe('dataset metrics', () => {
    it('should return datasets ID', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await createTestForm(service, container, testData.forms.simpleEntity.replace(/people|simpleEntity/g, 'employees'), 1);

      const datasets = await container.Analytics.getDatasets();
      datasets.length.should.be.equal(2);
      datasets[0].id.should.not.be.equal(datasets[1].id);
    }));

    it('should calculate properties', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await createTestForm(service, container, testData.forms.simpleEntity
        .replace(/simpleEntity/g, 'simpleEntity2')
        .replace(/age/g, 'gender'), 1);

      const datasets = await container.Analytics.getDatasets();
      datasets[0].num_properties.should.be.equal(3);
    }));

    it('should calculate creation forms', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await createTestForm(service, container, testData.forms.simpleEntity
        .replace(/simpleEntity/g, 'simpleEntity2')
        .replace(/age/g, 'gender'), 1);

      const datasets = await container.Analytics.getDatasets();
      datasets[0].num_creation_forms.should.be.equal(2);
    }));

    it('should calculate followup forms', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await createTestForm(service, container, testData.forms.withAttachments.replace(/goodone/g, 'people'), 1);
      const datasets = await container.Analytics.getDatasets();
      datasets[0].num_followup_forms.should.be.equal(1);
    }));

    it('should calculate entities', testService(async (service, container) => {
      const asAlice = await service.login('alice', identity);

      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one').send({ reviewState: 'approved' });
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two').send({ reviewState: 'approved' });
      await exhaust(container);

      await container.run(sql`UPDATE entities SET "createdAt" = '1999-1-1' WHERE TRUE`);

      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/three').send({ reviewState: 'approved' });
      await exhaust(container);

      const datasets = await container.Analytics.getDatasets();

      datasets[0].num_entities_total.should.be.equal(3);
      datasets[0].num_entities_recent.should.be.equal(1);
    }));

    it('should calculate failed entities', testService(async (service, container) => {
      const asAlice = await service.login('alice', identity);

      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one').send({ reviewState: 'approved' });

      // let's pass invalid UUID
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two.replace(/aaa/, 'xxx'));
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two').send({ reviewState: 'approved' });
      await exhaust(container);

      // let's set date of entity errors to long time ago
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1' WHERE action = 'entity.create.error'`);

      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three.replace(/bbb/, 'xxx'));
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/three').send({ reviewState: 'approved' });
      await exhaust(container);

      const datasets = await container.Analytics.getDatasets();

      datasets[0].num_failed_entities_total.should.be.equal(2);
      datasets[0].num_entities_recent.should.be.equal(1);
    }));

    it('should return right dataset of each projects', testService(async (service, container) => {

      const asAlice = await service.login('alice', identity);

      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one').send({ reviewState: 'approved' });

      const secondProjectId = await createTestProject(service, container, 'second');
      await createTestForm(service, container, testData.forms.simpleEntity.replace(/people|simpleEntity/g, 'employees'), secondProjectId);

      await exhaust(container);

      const dsInDatabase = (await container.all(sql`SELECT * FROM datasets`)).reduce((map, obj) => ({ [obj.id]: obj, ...map }), {});
      const datasets = await container.Analytics.getDatasets();

      const datasetOfFirstProject = datasets.find(d => d.projectId === 1);
      datasetOfFirstProject.id.should.be.equal(dsInDatabase[datasetOfFirstProject.id].id);
      datasetOfFirstProject.num_entities_total.should.be.equal(1);

      const datasetOfSecondProject = datasets.find(d => d.projectId === secondProjectId);
      datasetOfSecondProject.id.should.be.equal(dsInDatabase[datasetOfSecondProject.id].id);
      datasetOfSecondProject.num_entities_total.should.be.equal(0);

    }));
  });

  describe('other project metrics', () => {
    it('should calculate projects with descriptions', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .send({ description: 'test desc' }));

      const projWithDesc = await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'A project', description: 'a description' })
          .then(({ body }) => body.id));

      // null and empty string descriptions won't be counted
      const proj2 = await createTestProject(service, container, 'Proj with empty string description');
      await service.login('alice', (asAlice) =>
        asAlice.patch(`/v1/projects/${proj2}`)
          .send({ description: '' }));

      const proj3 = await createTestProject(service, container, 'Proj with null description');
      await service.login('alice', (asAlice) =>
        asAlice.patch(`/v1/projects/${proj3}`)
          .send({ description: null }));

      const res = await container.Analytics.getProjectsWithDescriptions();
      res.should.eql([{ projectId: 1, description_length: 9 }, { projectId: projWithDesc, description_length: 13 }]);
    }));
  });

  // eslint-disable-next-line space-before-function-paren, func-names
  describe('combined analytics', function () {
    // increasing timeouts on this set of tests
    this.timeout(4000);

    it('should combine system level queries', testService(async (service, container) => {
      // backups
      // eslint-disable-next-line object-curly-spacing
      await container.Configs.set('backups.main', { detail: 'dummy' });

      // encrypting a project
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' }));

      // creating and archiving a project
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Project' })
          .expect(200)
          .then(({ body }) => asAlice.patch(`/v1/projects/${body.id}`)
            .set('Content-Type', 'application/json')
            .send({ archived: true })
            .expect(200)));

      // creating more roles
      await createTestUser(service, container, 'Viewer1', 'viewer', 1);
      await createTestUser(service, container, 'Collector1', 'formfill', 1);

      const res = await container.Analytics.previewMetrics();

      // can't easily test this metric
      delete res.system.uses_external_db;

      // everything in system filled in
      Object.values(res.system).forEach((metric) =>
        (metric.total
          ? metric.total.should.be.above(0)
          : metric.should.be.above(0)));
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
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' }));

      // deleted and reused form id
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.delete('/v1/projects/1/forms/simple2'))
          .then(() => asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')));

      // make forms closed and closing to make count > 0
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple-geo')
            .send({ state: 'closing' })
            .expect(200)));

      const res = await container.Analytics.previewMetrics();

      // check everything is non-zero
      Object.values(res.projects[0].forms).forEach((metric) =>
        (metric.total
          ? metric.total.should.be.above(0)
          : metric.should.be.above(0)));
    }));

    it('should fill in all project.submissions queries', testService(async (service, container) => {
      // submission states
      for (const state of ['approved', 'rejected', 'hasIssues', 'edited']) {
        // eslint-disable-next-line no-await-in-loop
        await submitToForm(service, 'alice', 1, 'simple', simpleInstance(state));
        // eslint-disable-next-line no-await-in-loop
        await service.login('alice', (asAlice) =>
          asAlice.patch(`/v1/projects/1/forms/simple/submissions/${state}`)
            .send({ reviewState: state }));
      }

      // with edits
      await submitToForm(service, 'alice', 1, 'simple', simpleInstance('v1'));
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(withSimpleIds('v1', 'v2').replace('Alice', 'Alyssa')), { filename: 'data.xml' }));

      // comments
      await submitToForm(service, 'alice', 1, 'simple', testData.instances.simple.one, 'device1');
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
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

    it('should fill in all project.other queries', testService(async (service, container) => {
      await service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .send({ description: 'test desc' }));

      const res = await container.Analytics.previewMetrics();

      // check everything is non-zero
      Object.values(res.projects[0].other).forEach((metric) =>
        (metric.total
          ? metric.total.should.be.above(0)
          : metric.should.be.above(0)));
    }));

    it('should be idempotent and not cross-polute project counts', testService(async (service, container) => {
      const proj1 = await createTestProject(service, container, 'New Proj 1');
      await createTestForm(service, container, testData.forms.simple, proj1);

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

    it('should fill in all project.datasets queries', testService(async (service, container) => {
      const { defaultMaxListeners } = require('events').EventEmitter;
      require('events').EventEmitter.defaultMaxListeners = 30;

      const asAlice = await service.login('alice', identity);

      // Create first Dataset
      await createTestForm(service, container, testData.forms.simpleEntity, 1);

      // Make submission for the first Dataset
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one').send({ reviewState: 'approved' });

      // Create second Dataset using two forms
      await createTestForm(service, container, testData.forms.simpleEntity.replace(/simpleEntity|people/g, 'employees'), 1);
      await createTestForm(service, container, testData.forms.simpleEntity
        .replace(/simpleEntity/, 'employees2')
        .replace(/people/, 'employees')
        .replace(/age/g, 'gender'), 1);

      // Make submissions for the second Datasets
      await submitToForm(service, 'alice', 1, 'employees', testData.instances.simpleEntity.two.replace(/simpleEntity|people/g, 'employees'));
      await asAlice.patch('/v1/projects/1/forms/employees/submissions/two').send({ reviewState: 'approved' });
      await submitToForm(service, 'alice', 1, 'employees2', testData.instances.simpleEntity.three
        .replace(/simpleEntity/, 'employees2')
        .replace(/people/, 'employees')
        .replace(/age/g, 'gender'));
      await asAlice.patch('/v1/projects/1/forms/employees2/submissions/three').send({ reviewState: 'approved' });

      // Expecting all Submissions should generate Entities
      await exhaust(container);

      // Making all Entities ancient
      await container.run(sql`UPDATE entities SET "createdAt" = '1999-1-1' WHERE TRUE`);

      // Make a recent Submissions for the first Dataset
      // aaa -> ccc creates unique UUID
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two.replace('aaa', 'ccc'));
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two').send({ reviewState: 'approved' });

      // bbb -> xxx causes invalid UUID, hence this Submission should not generate Entity
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three.replace('bbb', 'xxx'));
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/three').send({ reviewState: 'approved' });

      // One Entity will be created and one error will be logged
      await exhaust(container);

      // Make the error ancient
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1' WHERE action = 'entity.create.error'`);

      // Create new Submission that will cause entity creation error
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three.replace(/bbb|three/g, 'xxx'));
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/xxx').send({ reviewState: 'approved' });

      // One error will be logged
      await exhaust(container);

      // Link both Datasets to a Form
      await createTestForm(service, container, testData.forms.withAttachments
        .replace(/goodone/g, 'people')
        .replace(/files\/badsubpath/g, 'file/employees'), 1);

      // Create an empty project
      const secondProject = await createTestProject(service, container, 'second');
      await createTestForm(service, container, testData.forms.simple, secondProject);

      const res = await container.Analytics.previewMetrics();

      const { id, ...firstDataset } = res.projects[0].datasets[0];
      const { id: _, ...secondDataset } = res.projects[0].datasets[1];

      firstDataset.should.be.eql({
        num_properties: 2,
        num_creation_forms: 1,
        num_followup_forms: 1,
        num_entities: {
          total: 2, // made one Entity ancient
          recent: 1
        },
        num_failed_entities: { // two Submissions failed due to invalid UUID
          total: 2, // made one Error ancient
          recent: 1
        }
      });

      secondDataset.should.be.eql({
        num_properties: 3, // added third Property (age -> gender)
        num_creation_forms: 2, // used two Forms to create Dataset
        num_followup_forms: 1,
        num_entities: {
          total: 2,
          recent: 0
        },
        num_failed_entities: {
          total: 0,
          recent: 0
        }
      });

      // Assert that a Project without a Dataset returns an empty array
      res.projects[1].datasets.should.be.eql([]);

      // revert to original default
      require('events').defaultMaxListeners = defaultMaxListeners;
    }));
  });

  describe('latest analytics audit log utility', () => {
    it('should find recently created analytics audit log', testService(async (service, container) => {
      // eslint-disable-next-line object-curly-spacing
      await container.Audits.log(null, 'analytics', null, { test: 'foo', success: true });
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
      // eslint-disable-next-line object-curly-spacing
      await container.Audits.log(null, 'analytics', null, { test: 'foo', success: true });
      // make all analytics audits so far in the distant past
      await container.all(sql`update audits set "loggedAt" = '1999-1-1' where action = 'analytics'`);
      const res = await container.Analytics.getLatestAudit();
      res.isEmpty().should.equal(true);
    }));
  });
});

