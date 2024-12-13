const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testService, testContainer } = require('../setup');
const { createReadStream, readFileSync } = require('fs');
const uuid = require('uuid').v4;

const { promisify } = require('util');
const testData = require('../../data/xml');
const { exhaust, workerQueue } = require(appRoot + '/lib/worker/worker');

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
describe('analytics task queries', function () {
  // increasing timeouts on this set of tests
  this.timeout(8000);

  describe('general server metrics', () => {
    it('should count audit log entries', testContainer(async (container) => {
      // recent "now" audits
      await container.Audits.log(null, 'dummy.action', null, 'test audit details');
      await container.Audits.log(null, 'dummy.action', null, 'test audit details');
      // old audit
      await container.run(sql`insert into audits ("actorId", action, "acteeId", details, "loggedAt")
        values (null, 'dummy.action', null, null, '1999-1-1T00:00:00Z')`);
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

    it('should check external blob store configurations', testContainer(async ({ Analytics }) => {
      Analytics.blobStoreExternal(null).should.equal(0);
      Analytics.blobStoreExternal({}).should.equal(0);
      Analytics.blobStoreExternal({ server: 'http://external.store' }).should.equal(1);
      Analytics.blobStoreExternal({ server: 'http://external.store', accessKey: 'a', bucketName: 'foo' }).should.equal(1);
    }));

    describe('counting client audits', () => {
      it('should count the total number of client audit submission attachments', testService(async (service, { Analytics }) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200);

        // the one sub with good client audit attachment
        await asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
          .expect(201);

        // client audit attachment is missing
        await asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
          .expect(201);

        // another attachment that is not a client audit
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.one), { filename: 'data.xml' })
            .attach('my_file1.mp4', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'my_file1.mp4' })
            .expect(201));

        const res = await Analytics.countClientAuditAttachments();
        res.should.equal(1);
      }));

      it('should count client audit attachments that failed processing', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // encrypt default project and send one encrypted client audit attachment
        const { extractPubkey, extractVersion, sendEncrypted } = require(appRoot + '/test/util/crypto-odk');
        await asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.clientAudits)
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/audits.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.clientAudits.one, { 'audit.csv.enc': readFileSync(appRoot + '/test/data/audit.csv') })));

        await exhaust(container);

        // at this point there should be 0 failed
        await container.Analytics.countClientAuditProcessingFailed()
          .then((res) => res.should.equal(0));

        // but there will be 0 rows in the clients audits table bc encrypted ones dont get extracted
        await container.Analytics.countClientAuditRows()
          .then((res) => res.should.equal(0));

        // make a new project to not encrypt
        const newProjectId = await asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'Test Project' })
          .expect(200)
          .then(({ body }) => body.id);

        await asAlice.post(`/v1/projects/${newProjectId}/forms?publish=true`)
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200);

        // submit a new submission with client audit attachment
        await asAlice.post(`/v1/projects/${newProjectId}/submission`)
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
          .expect(201);

        // fail the processing of this latest event
        let event = (await container.Audits.getLatestByAction('submission.attachment.update')).get();
        const jobMap = { 'submission.attachment.update': [ () => Promise.reject(new Error()) ] };
        await promisify(workerQueue(container, jobMap).run)(event);

        // should still be 0 because the failure count is only at 1, needs to be at 5 to count
        event = (await container.Audits.getLatestByAction('submission.attachment.update')).get();
        event.failures.should.equal(1);
        await container.Analytics.countClientAuditProcessingFailed()
          .then((res) => res.should.equal(0));

        // there should still be 0 extracted client audit rows
        await container.Analytics.countClientAuditRows()
          .then((res) => res.should.equal(0));

        // manually upping failure count to 5
        await container.run(sql`update audits set failures = 5, "loggedAt" = '1999-01-01' where id = ${event.id}`);

        await container.Analytics.countClientAuditProcessingFailed()
          .then((res) => res.should.equal(1));

        await container.Analytics.auditLogs()
          .then((res) => {
            res.any_failure.should.equal(1);
            res.failed5.should.equal(1);
            res.unprocessed.should.equal(0);
          });
      }));

      it('should count the number of rows extracted from client audit attachments', testService(async (service, container) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200);

        await asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
          .expect(201);

        await asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
          .expect(201);

        await container.Analytics.countClientAuditRows()
          .then((res) => res.should.equal(0));

        await exhaust(container);

        await container.Analytics.countClientAuditRows()
          .then((res) => res.should.equal(8));
      }));

      it('should count rows from client audit attachments uploaded to s3', testService(async (service, container) => {
        global.s3.enableMock();

        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200);

        await asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
          .expect(201);

        await asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
          .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
          .expect(201);

        await container.Analytics.countClientAuditRows()
          .then((res) => res.should.equal(0));

        await container.Blobs.s3UploadPending();
        await exhaust(container);

        await container.Analytics.countClientAuditRows()
          .then((res) => res.should.equal(8));
      }));
    });

    it('should count failed audits', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.clientAudits)
        .expect(200);

      // making the processing of this attachment fail once
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
        .expect(201);

      const jobMap = { 'submission.attachment.update': [ () => Promise.reject(new Error()) ] };
      const eventOne = (await container.Audits.getLatestByAction('submission.attachment.update')).get();
      await promisify(workerQueue(container, jobMap).run)(eventOne);

      // making this look like it failed 5 times
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
        .expect(201);


      // we haven't run exhaust(container so there are some unprocessed events)
      const eventTwo = (await container.Audits.getLatestByAction('submission.attachment.update')).get();
      await container.run(sql`update audits set failures = 5 where id = ${eventTwo.id}`);

      const eventSubCreate = (await container.Audits.getLatestByAction('submission.create')).get();
      await container.run(sql`update audits set "loggedAt" = '2000-01-01T00:00Z' where id = ${eventSubCreate.id}`);

      await container.Analytics.auditLogs()
        .then((res) => {
          res.any_failure.should.equal(2);
          res.failed5.should.equal(1);
          res.unprocessed.should.equal(1);
        });
    }));

    it('should count form definitions that are XML-only and are not associated with an XLSForm', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Adds a 3rd form def that does ahve an associated XLSForm so shouldn't be counted
      await asAlice.post('/v1/projects/1/forms')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .set('X-XlsForm-FormId-Fallback', 'testformid')
        .expect(200);

      const xmlOnlyFormDefs = await container.Analytics.countXmlOnlyFormDefs();
      xmlOnlyFormDefs.should.equal(2);
    }));

    it('should count the number of binary blob files total and uploaded to external store', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200);

      // make 2 blobs from submission attachments
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
        .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
        .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
        .expect(201);

      // Set upload status on existing blobs
      await container.run(sql`update blobs set "s3_status" = 'uploaded' where true`);

      // make a new blob by uploading xlsform
      await asAlice.post('/v1/projects/1/forms')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .set('X-XlsForm-FormId-Fallback', 'testformid')
        .expect(200);

      const blobs = await container.Analytics.countBlobFiles();
      blobs.should.eql({ total_blobs: 3, uploaded_blobs: 2 });
    }));

    it('should count number of reset failed blob uploads', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200);

      // make 2 blobs from submission attachments
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
        .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
        .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
        .expect(201);

      // set upload status on existing blobs to failed
      await container.run(sql`update blobs set "s3_status" = 'failed' where true`);

      // reset failed to pending
      await container.Blobs.s3SetFailedToPending();

      // count events
      const count = await container.Analytics.countResetFailedToPending();
      count.should.equal(1);
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
      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);
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
      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);
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
        asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.delete('/v1/projects/1/forms/simple2'))
          .then(() => asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')));

      // delete multiple times (only count 1 active form with reused id)
      const proj2 = await createTestProject(service, container, 'New Proj');
      await service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/${proj2}/forms`)
          .send(testData.forms.simple)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.delete(`/v1/projects/${proj2}/forms/simple`))
          .then(() => asAlice.post(`/v1/projects/${proj2}/forms?publish=true&ignoreWarnings=true`)
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml'))
          .then(() => asAlice.delete(`/v1/projects/${proj2}/forms/simple`))
          .then(() => asAlice.post(`/v1/projects/${proj2}/forms?publish=true&ignoreWarnings=true`)
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
      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);
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

      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);

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

      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);

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

      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);

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

      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);

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
      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);
      await container.all(sql`update submission_defs set "createdAt" = '1999-1-1T00:00:00Z' where true`);

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
      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);
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
      await container.all(sql`update submissions set "createdAt" = '1999-1-1T00:00:00Z' where true`);
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

      const datasets = await container.Analytics.getDatasetProperties();
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
      const asAlice = await service.login('alice');

      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one').send({ reviewState: 'approved' });
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two').send({ reviewState: 'approved' });
      await exhaust(container);

      await container.run(sql`UPDATE entities SET "createdAt" = '1999-1-1T00:00:00Z' WHERE TRUE`);

      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/three').send({ reviewState: 'approved' });
      await exhaust(container);

      const datasets = await container.Analytics.getDatasets();

      datasets[0].num_entities_total.should.be.equal(3);
      datasets[0].num_entities_recent.should.be.equal(1);
    }));

    it('should calculate failed entities', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);

      // let's pass invalid UUID
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two.replace(/aaa/, 'xxx'));
      await exhaust(container);

      // let's set date of entity errors to long time ago
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action = 'entity.error'`);

      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three.replace(/bbb/, 'xxx'));
      await exhaust(container);

      const datasets = await container.Analytics.getDatasets();

      datasets[0].num_failed_entities_total.should.be.equal(2);
      datasets[0].num_failed_entities_recent.should.be.equal(1);
    }));

    it('should calculate entity updates', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three);
      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '2', first_name: 'John' }, label: 'John (12)' })
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '1' } })
        .expect(200);

      // let's set date of entity update to long time ago
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action = 'entity.update.version'`);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '2' } })
        .expect(200);

      const datasets = await container.Analytics.getDatasets();

      datasets[0].num_entity_updates_total.should.be.equal(3);
      datasets[0].num_entity_updates_recent.should.be.equal(1);
    }));

    it('should calculate entity updates through different sources like API and submission', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three);
      await exhaust(container);

      await createTestForm(service, container, testData.forms.updateEntity, 1);
      await submitToForm(service, 'alice', 1, 'updateEntity', testData.instances.updateEntity.one);
      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '2', first_name: 'John' }, label: 'John (12)' })
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '1' } })
        .expect(200);

      // let's set date of entity update to long time ago
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action = 'entity.update.version'`);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '2' } })
        .expect(200);

      await submitToForm(service, 'alice', 1, 'updateEntity', testData.instances.updateEntity.two);
      await exhaust(container);

      const datasets = await container.Analytics.getDatasets();

      datasets[0].num_entity_updates_api_total.should.be.equal(3);
      datasets[0].num_entity_updates_api_recent.should.be.equal(1);
      datasets[0].num_entity_updates_sub_total.should.be.equal(2);
      datasets[0].num_entity_updates_sub_recent.should.be.equal(1);

      datasets[0].num_entity_updates_total.should.be.equal(datasets[0].num_entity_updates_api_total + datasets[0].num_entity_updates_sub_total);
      datasets[0].num_entity_updates_recent.should.be.equal(datasets[0].num_entity_updates_api_recent + datasets[0].num_entity_updates_sub_recent);
    }));

    it('should calculate entity creates through different sources (submission, API, bulk', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      await createTestForm(service, container, testData.forms.simpleEntity, 1);

      // Create entity via submission
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);

      // Create entity via API
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      // Create 3 entities in bulk
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: { name: 'people.csv', size: 100, },
          entities: [ { label: 'a label' }, { label: 'a label' }, { label: 'a label' } ]
        })
        .expect(200);

      // let's set date of entity update to long time ago
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action in ('entity.create', 'entity.bulk.create')`);

      // Create more recent entities
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          label: 'foo',
          data: { first_name: 'Blaise' }
        })
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: { name: 'people.csv', size: 100, },
          entities: [ { label: 'a label' }, { label: 'a label' }, { label: 'a label' } ]
        })
        .expect(200);

      const datasets = await container.Analytics.getDatasets();

      datasets[0].num_entity_create_sub_total.should.be.equal(0);
      datasets[0].num_entity_create_sub_recent.should.be.equal(0);
      datasets[0].num_entity_create_api_total.should.be.equal(2);
      datasets[0].num_entity_create_api_recent.should.be.equal(1);
      datasets[0].num_entity_create_bulk_total.should.be.equal(6);
      datasets[0].num_entity_create_bulk_recent.should.be.equal(3);
    }));

    it('should calculate number of entities ever updated vs. update actions applied', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one); // abc
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two); // aaa
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three); // bbb
      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '2', first_name: 'John' }, label: 'John (12)' })
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '1' } })
        .expect(200);

      // let's set date of entity update to long time ago
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action = 'entity.update.version'`);

      // let's set entity updatedAt to a long time ago, too
      await container.run(sql`UPDATE entities SET "updatedAt" = '1999-1-1T00:00:00Z' WHERE "uuid" = '12345678-1234-4123-8234-123456789abc'`);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '2' } })
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '3' } })
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { age: '4' } })
        .expect(200);

      // entity abc has been updated once, in the past
      // entity aaa has been updated many times (once in the past, 3 times recently)
      // entity bbb has never been updated

      const datasets = await container.Analytics.getDatasets();

      // 3 entities total
      datasets[0].num_entities_total.should.be.equal(3);

      // 2 entities ever updated
      datasets[0].num_entities_updated_total.should.be.equal(2);
      datasets[0].num_entities_updated_recent.should.be.equal(1);

      // 5 update events
      datasets[0].num_entity_updates_total.should.be.equal(5);
      datasets[0].num_entity_updates_recent.should.be.equal(3);
    }));

    it('should calculate number of entities ever with conflict, and which are currently resolved', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await createTestForm(service, container, testData.forms.updateEntity, 1);
      await exhaust(container);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Aaa',
          data: { first_name: 'Aaa', age: '22' }
        })
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789aaa',
          label: 'Bbb',
          data: { first_name: 'Bbb', age: '22' }
        })
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789bbb',
          label: 'Bbb',
          data: { first_name: 'Bbb', age: '22' }
        })
        .expect(200);

      // create first conflict on abc
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '99' } })
        .expect(200);

      // .one updates name and age
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // create soft conflict
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa?force=true')
        .send({ data: { first_name: 'Aaa 2' } })
        .expect(200);

      // .three updates age
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.three.replace('12345678-1234-4123-8234-123456789abc', '12345678-1234-4123-8234-123456789aaa'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&force=true')
        .expect(200);

      const datasets = await container.Analytics.getDatasets();

      // 3 entities total
      datasets[0].num_entities_total.should.be.equal(3);
      datasets[0].num_entity_conflicts.should.be.equal(2);
      datasets[0].num_entity_conflicts_resolved.should.be.equal(1);

      // putting abc back into conflict makes current resolved count get set to 0 again
      // .two updates label
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const datasets2 = await container.Analytics.getDatasets();
      datasets2[0].num_entity_conflicts.should.be.equal(2);
      datasets2[0].num_entity_conflicts_resolved.should.be.equal(0);
    }));

    it('should return right dataset of each projects', testService(async (service, container) => {

      const asAlice = await service.login('alice');

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

    it('should return recent and total entity.bulk.create events per dataset', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // First dataset in first project: "people"
      await asAlice.post('/v1/projects/1/datasets')
        .send({ name: 'people' })
        .expect(200);

      // Past bulk upload with 3 rows in "people"
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: { name: 'people.csv', size: 100, },
          entities: [ { label: 'a label' }, { label: 'a label' }, { label: 'a label' } ]
        })
        .expect(200);

      const secondProjectId = await createTestProject(service, container, 'second');

      // First dataset in second project: "shovels"
      await asAlice.post(`/v1/projects/${secondProjectId}/datasets`)
        .send({ name: 'shovels' })
        .expect(200);

      // Past bulk upload with 1 row in "shovels"
      await asAlice.post(`/v1/projects/${secondProjectId}/datasets/shovels/entities`)
        .send({
          source: { name: 'shovels.csv', size: 100, },
          entities: [ { label: 'a label' } ]
        })
        .expect(200);

      // Make existing audits in the distant past
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action = 'entity.bulk.create'`);

      // Recent bulk upload with 1 row in "people"
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: { name: 'people.csv', size: 100, },
          entities: [ { label: 'a label' } ]
        })
        .expect(200);

      const dsInDatabase = (await container.all(sql`SELECT * FROM datasets`)).reduce((map, obj) => ({ [obj.id]: obj, ...map }), {});
      const datasets = await container.Analytics.getDatasetEvents();

      const datasetOfFirstProject = datasets.find(d => d.projectId === 1);
      datasetOfFirstProject.id.should.be.equal(dsInDatabase[datasetOfFirstProject.id].id);
      datasetOfFirstProject.num_bulk_create_events_total.should.be.equal(2);
      datasetOfFirstProject.num_bulk_create_events_recent.should.be.equal(1);
      datasetOfFirstProject.biggest_bulk_upload.should.be.equal(3);

      const datasetOfSecondProject = datasets.find(d => d.projectId === secondProjectId);
      datasetOfSecondProject.id.should.be.equal(dsInDatabase[datasetOfSecondProject.id].id);
      datasetOfSecondProject.num_bulk_create_events_total.should.be.equal(1);
      datasetOfSecondProject.num_bulk_create_events_recent.should.be.equal(0);
      datasetOfSecondProject.biggest_bulk_upload.should.be.equal(1);
    }));

    it('should show dataset event metrics within project metrics', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // First dataset in first project: "people"
      await asAlice.post('/v1/projects/1/datasets')
        .send({ name: 'people' })
        .expect(200);

      // Recent bulk upload with 1 row in "people"
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: { name: 'people.csv', size: 100, },
          entities: [ { label: 'a label' } ]
        })
        .expect(200);

      const projects = await container.Analytics.projectMetrics();
      const ds = projects[0].datasets[0];
      ds.num_bulk_create_events.should.eql({ total: 1, recent: 1 });
      ds.biggest_bulk_upload.should.equal(1);
    }));

    it('should combine dataset event metrics with other project metrics even if no bulk create events', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // First dataset in first project: "people"
      await asAlice.post('/v1/projects/1/datasets')
        .send({ name: 'people' })
        .expect(200);

      const projects = await container.Analytics.projectMetrics();
      const ds = projects[0].datasets[0];
      ds.num_bulk_create_events.should.eql({ total: 0, recent: 0 });
      ds.biggest_bulk_upload.should.equal(0);
    }));
  });

  describe('offline entity metrics', () => {
    it('should count number of offline entity branches (nontrivial branches with >1 update)', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.offlineEntity, 1);

      const asAlice = await service.login('alice');

      // Entity version from API doesn't have a branchId so doesn't count
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      // Branch with only update (trunkVersion = baseVersion, doesn't count)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${uuid()}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Branch with two updates (does count)
      const branchIdOne = uuid();
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update1')
          .replace('branchId=""', `branchId="${branchIdOne}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${branchIdOne}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Branch with create, then update (does count)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
        )
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${uuid()}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const countOfflineBranches = await container.Analytics.countOfflineBranches();
      countOfflineBranches.should.equal(2);

      // Sanity check this count, should be 0
      const countInterruptedBranches = await container.Analytics.countInterruptedBranches();
      countInterruptedBranches.should.equal(0);
    }));

    it('should count number of interrupted branches', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.offlineEntity, 1);

      const asAlice = await service.login('alice');

      // make some entities to update
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          entities: [
            { uuid: '12345678-1234-4123-8234-123456789aaa', label: 'aaa' },
            { uuid: '12345678-1234-4123-8234-123456789bbb', label: 'bbb' },
            { uuid: '12345678-1234-4123-8234-123456789ccc', label: 'ccc' },
            { uuid: '12345678-1234-4123-8234-123456789ddd', label: 'ddd' },
          ],
          source: { name: 'api', size: 3 }
        })
        .expect(200);

      // aaa entity, branches: A, A, B, A (counts as interrupted)
      const aaaBranchA = uuid();
      const aaaBranchB = uuid();
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789aaa')
          .replace('one', 'aaa-v1')
          .replace('branchId=""', `branchId="${aaaBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789aaa')
          .replace('one', 'aaa-v2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${aaaBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789aaa')
          .replace('one', 'aaa-interrupt')
          .replace('branchId=""', `branchId="${aaaBranchB}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789aaa')
          .replace('one', 'aaa-v3')
          .replace('baseVersion="1"', 'baseVersion="3"')
          .replace('branchId=""', `branchId="${aaaBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // bbb entity, branches: A, A, B, B (not counted)
      const bbbBranchA = uuid();
      const bbbBranchB = uuid();
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789bbb')
          .replace('one', 'bbb-v1')
          .replace('branchId=""', `branchId="${bbbBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789bbb')
          .replace('one', 'bbb-v2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${bbbBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789bbb')
          .replace('one', 'bbb-newbranch-v1')
          .replace('branchId=""', `branchId="${bbbBranchB}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789bbb')
          .replace('one', 'bbb-newbranch-v2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${bbbBranchB}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // ccc entity, branches: A, B, A, B  (counted twice)
      const cccBranchA = uuid();
      const cccBranchB = uuid();
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789ccc')
          .replace('one', 'ccc-v1')
          .replace('branchId=""', `branchId="${cccBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789ccc')
          .replace('one', 'ccc-newbranch-v1')
          .replace('branchId=""', `branchId="${cccBranchB}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789ccc')
          .replace('one', 'ccc-v2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${cccBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789ccc')
          .replace('one', 'ccc-newbranch-v2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${cccBranchB}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // ddd entity, branches A, (api update), A
      const dddBranchA = uuid();
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789ddd')
          .replace('one', 'ddd-v1')
          .replace('branchId=""', `branchId="${dddBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd?baseVersion=2')
        .send({ label: 'ddd update' })
        .expect(200);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ddd?baseVersion=3')
        .send({ label: 'ddd update2' })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('id="12345678-1234-4123-8234-123456789abc', 'id="12345678-1234-4123-8234-123456789ddd')
          .replace('one', 'ddd-v2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${dddBranchA}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      const countInterruptedBranches = await container.Analytics.countInterruptedBranches();
      countInterruptedBranches.should.equal(4);
    }));

    it('should count number of submission.backlog.* events (submissions temporarily in the backlog)', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.offlineEntity, 1);

      const asAlice = await service.login('alice');

      // Create entity to update
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'label'
        })
        .expect(200);

      const branchId = uuid();

      // Send second update in branch first
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update1')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Should be in backlog
      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      // Send first update in
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // backlog should be empty now
      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);

      let countBacklogEvents = await container.Analytics.countSubmissionBacklogEvents();
      countBacklogEvents.should.eql({
        'submission.backlog.hold': 1,
        'submission.backlog.reprocess': 1,
        'submission.backlog.force': 0
      });

      // Send a future update that will get held in backlog
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update10')
          .replace('baseVersion="1"', 'baseVersion="10"')
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      // A submission being put in the backlog is not what is counted so reprocess count is still 1
      countBacklogEvents = await container.Analytics.countSubmissionBacklogEvents();
      countBacklogEvents.should.eql({
        'submission.backlog.hold': 2,
        'submission.backlog.reprocess': 1,
        'submission.backlog.force': 0
      });

      // force processing the backlog
      await container.Entities.processBacklog(true);

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);

      // Force processing counted now, and reprocessing still only counted once
      countBacklogEvents = await container.Analytics.countSubmissionBacklogEvents();
      countBacklogEvents.should.eql({
        'submission.backlog.hold': 2,
        'submission.backlog.reprocess': 1,
        'submission.backlog.force': 1
      });

      //----------

      // Trigger another reprocess by sending an update before a create
      const branchId2 = uuid();

      // Send the second submission that updates an entity (before the entity has been created)
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId2}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      // Send the second submission to create the entity, which should trigger
      // the processing of the next submission in the branch.
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Two reprocessing events logged now
      countBacklogEvents = await container.Analytics.countSubmissionBacklogEvents();
      countBacklogEvents.should.eql({
        'submission.backlog.hold': 3,
        'submission.backlog.reprocess': 2,
        'submission.backlog.force': 1
      });
    }));

    it('should measure time from submission creation to entity version finished processing', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.offlineEntity, 1);

      const asAlice = await service.login('alice');

      // Make an entity that doesn't have a source
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      // times may be null if no submissions have been processed
      let waitTime = await container.Analytics.measureEntityProcessingTime();
      waitTime.should.eql({ max_wait: null, avg_wait: null });

      // Make an entity update
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${uuid()}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Make another entity create
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
      waitTime = await container.Analytics.measureEntityProcessingTime();
      waitTime.max_wait.should.be.greaterThan(0);
      waitTime.avg_wait.should.be.greaterThan(0);
    }));

    it('should measure max time between first submission on a branch received and last submission on that branch processed', testService(async (service, container) => {
      await createTestForm(service, container, testData.forms.offlineEntity, 1);
      const asAlice = await service.login('alice');

      const emptyTime = await container.Analytics.measureMaxEntityBranchTime();
      emptyTime.should.equal(0);

      // Create entity to update
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'label'
        })
        .expect(200);

      const branchId = uuid();

      // Send first update
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Send second update
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Send third update in its own branch
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update3')
          .replace('baseVersion="1"', 'baseVersion="3"')
          .replace('trunkVersion="1"', 'trunkVersion="3"')
          .replace('branchId=""', `branchId="${uuid()}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Make another update via the API
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=4')
        .send({ label: 'label update' })
        .expect(200);

      const time = await container.Analytics.measureMaxEntityBranchTime();
      time.should.be.greaterThan(0);

      // Set date of entity defs in first branch to 1 day apart
      await container.run(sql`UPDATE entity_defs SET "createdAt" = '1999-01-01' WHERE version = 2`);
      await container.run(sql`UPDATE entity_defs SET "createdAt" = '1999-01-02' WHERE version = 3`);
      const longTime = await container.Analytics.measureMaxEntityBranchTime();
      longTime.should.be.equal(86400); // number of seconds in a day
    }));

    it('should not see a delay for submissions processed with approvalRequired flag toggled', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Create form, set dataset people to approvalRequired = true
      await createTestForm(service, container, testData.forms.simpleEntity, 1);
      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      // Send submission
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);

      // Process submission
      await exhaust(container);

      const processTimes1 = await container.one(sql`select "claimed", "processed", "loggedAt" from audits where action = 'submission.create'`);

      // Wait times shouldn't be set yet because submission hasn't been processed into an entity
      let waitTime = await container.Analytics.measureEntityProcessingTime();
      waitTime.should.eql({ max_wait: null, avg_wait: null });

      // wait 100ms
      // eslint-disable-next-line no-promise-executor-return
      await new Promise(resolve => setTimeout(resolve, 100));

      // Toggle approvalRequired flag
      await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
        .send({ approvalRequired: false })
        .expect(200);

      await exhaust(container);

      // Wait times are now measured but they are from the initial processing of the submission.create event
      // (when it was skipped because the dataset approval was required)
      waitTime = await container.Analytics.measureEntityProcessingTime();
      waitTime.max_wait.should.be.greaterThan(0);
      waitTime.avg_wait.should.be.greaterThan(0);

      const processTimes2 = await container.one(sql`select "claimed", "processed", "loggedAt" from audits where action = 'submission.create'`);
      processTimes1.should.eql(processTimes2);

      // Overall time from submission creation to entity version creation should be higher
      // because it includes delay from dataset approval flag toggle
      const entityTime = await container.Analytics.measureElapsedEntityTime();
      entityTime.max_wait.should.be.greaterThan(waitTime.max_wait + 0.1);
      entityTime.avg_wait.should.be.greaterThan(waitTime.avg_wait + 0.1);
    }));

    it('should not see a delay for submissions held in backlog and then force-processed', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      await createTestForm(service, container, testData.forms.offlineEntity, 1);

      // Send an update without the preceeding create
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${uuid()}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      let backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(1);

      // The submission.create event does have timestamps on it that we will compare later
      const processTimes1 = await container.one(sql`select "claimed", "processed", "loggedAt" from audits where action = 'submission.create'`);

      // Wait times shouldn't be set yet because submission hasn't been processed into an entity
      let waitTime = await container.Analytics.measureEntityProcessingTime();
      waitTime.should.eql({ max_wait: null, avg_wait: null });

      // wait 100ms
      // eslint-disable-next-line no-promise-executor-return
      await new Promise(resolve => setTimeout(resolve, 100));

      // force processing the backlog
      await container.Entities.processBacklog(true);

      backlogCount = await container.oneFirst(sql`select count(*) from entity_submission_backlog`);
      backlogCount.should.equal(0);

      // Wait times are now measured but they are from the initial processing of the submission.create event
      // (when it was skipped because it went into backlog)
      waitTime = await container.Analytics.measureEntityProcessingTime();
      waitTime.max_wait.should.be.greaterThan(0);
      waitTime.avg_wait.should.be.greaterThan(0);

      const processTimes2 = await container.one(sql`select "claimed", "processed", "loggedAt" from audits where action = 'submission.create'`);
      processTimes1.should.eql(processTimes2);

      // Overall time for entity creation should be higher because it includes the delay
      // from waiting in the backlog before being force-processed
      const entityTime = await container.Analytics.measureElapsedEntityTime();
      entityTime.max_wait.should.be.greaterThan(waitTime.max_wait + 0.1);
      entityTime.avg_wait.should.be.greaterThan(waitTime.avg_wait + 0.1);
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

  describe('combined analytics', () => {
    it('should combine system level queries', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // creating client audits (before encrypting the project)
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.clientAudits)
        .expect(200);

      // the one sub with good client audit attachment
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
        .expect(201);

      await exhaust(container);

      // add another client audit attachment to fail
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
        .expect(201);

      // alter the second unprocessed client audit event to count as a failure
      const event = (await container.Audits.getLatestByAction('submission.attachment.update')).get();
      await container.run(sql`update audits set failures = 5 where id = ${event.id}`);


      // 2024.2 offline entity metrics

      // create the form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.offlineEntity)
        .expect(200);

      // Creating an update chain
      // API create
      // update 2, update 1, (out of order reprocessing)
      // API update (interrupt branch)
      // update 3
      const branchId = uuid();

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'abc',
        })
        .expect(200);

      // switching the order of these updates triggers the
      // submission.backlog.reprocess count
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update2')
          .replace('baseVersion="1"', 'baseVersion="2"')
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update1')
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // inserting an API update before continuing the branch triggers
      // the interrupted branch count
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=3')
        .send({ label: 'abc update' })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update3')
          .replace('baseVersion="1"', 'baseVersion="3"')
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // sending in an update much later in the chain that will need to be force processed
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.one
          .replace('one', 'one-update10')
          .replace('baseVersion="1"', 'baseVersion="10"')
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
      await container.Entities.processBacklog(true);

      // After the interesting stuff above, encrypt and archive the project

      // encrypting a project
      await asAlice.post('/v1/projects/1/key')
        .send({ passphrase: 'supersecret', hint: 'it is a secret' });

      // creating and archiving a project
      await asAlice.post('/v1/projects')
        .set('Content-Type', 'application/json')
        .send({ name: 'New Project' })
        .expect(200)
        .then(({ body }) => asAlice.patch(`/v1/projects/${body.id}`)
          .set('Content-Type', 'application/json')
          .send({ archived: true })
          .expect(200));

      // creating more roles
      await createTestUser(service, container, 'Viewer1', 'viewer', 1);
      await createTestUser(service, container, 'Collector1', 'formfill', 1);

      // creating audit events in various states
      await container.run(sql`insert into audits ("actorId", action, "acteeId", details, "loggedAt", "failures")
        values
          (null, 'dummy.action', null, null, '1999-1-1T00:00:00Z', 1),
          (null, 'dummy.action', null, null, '1999-1-1T00:00:00Z', 5),
          (null, 'dummy.action', null, null, '1999-1-1T00:00:00Z', 0)`);

      const res = await container.Analytics.previewMetrics();

      // can't easily test this metric
      delete res.system.uses_external_db;
      delete res.system.sso_enabled;
      delete res.system.uses_external_blob_store;
      delete res.system.num_blob_files_on_s3;
      delete res.system.num_reset_failed_to_pending_count;

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
        asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.delete('/v1/projects/1/forms/simple2'))
          .then(() => asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
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
      const asAlice = await service.login('alice');

      // Create first Dataset
      await createTestForm(service, container, testData.forms.simpleEntity, 1);

      // Make submission for the first Dataset
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.one);

      // Create second Dataset using two forms
      await createTestForm(service, container, testData.forms.simpleEntity.replace(/simpleEntity|people/g, 'employees'), 1);
      await createTestForm(service, container, testData.forms.simpleEntity
        .replace(/simpleEntity/, 'employees2')
        .replace(/people/, 'employees')
        .replace(/age/g, 'gender'), 1);

      // Make submissions for the second Datasets
      await submitToForm(service, 'alice', 1, 'employees', testData.instances.simpleEntity.two.replace(/simpleEntity|people/g, 'employees'));
      await submitToForm(service, 'alice', 1, 'employees2', testData.instances.simpleEntity.three
        .replace(/simpleEntity/, 'employees2')
        .replace(/people/, 'employees')
        .replace(/age/g, 'gender'));

      // Expecting all Submissions should generate Entities
      await exhaust(container);

      // Making all Entities ancient
      await container.run(sql`UPDATE entities SET "createdAt" = '1999-1-1T00:00:00Z' WHERE TRUE`);

      // Make a recent Submissions for the first Dataset
      // aaa -> ccc creates unique UUID
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.two.replace('aaa', 'ccc'));

      // bbb -> xxx causes invalid UUID, hence this Submission should not generate Entity
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three.replace('bbb', 'xxx'));

      // One Entity will be created and one error will be logged
      await exhaust(container);

      // Make the error ancient
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action = 'entity.error'`);

      // Create new Submission that will cause entity creation error
      await submitToForm(service, 'alice', 1, 'simpleEntity', testData.instances.simpleEntity.three.replace(/bbb|three/g, 'xxx'));

      // One error will be logged
      await exhaust(container);

      // Update an entity
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '1' } });

      // Make the update ancient
      await container.run(sql`UPDATE audits SET "loggedAt" = '1999-1-1T00:00:00Z' WHERE action = 'entity.update.version'`);

      // Update the same entity again
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '2' } });

      // Make another conflict via submission and then resolve it
      await createTestForm(service, container, testData.forms.updateEntity, 1);
      await submitToForm(service, 'alice', 1, 'updateEntity', testData.instances.updateEntity.one);
      await exhaust(container);
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true&resolve=true');

      // Link both Datasets to a Form
      await createTestForm(service, container, testData.forms.withAttachments
        .replace(/goodone/g, 'people')
        .replace(/files\/badsubpath/g, 'file/employees'), 1);

      // Create entities in bulk
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: { name: 'people.csv', size: 100, },
          entities: [ { label: 'a label' }, { label: 'a label' }, { label: 'a label' } ]
        })
        .expect(200);

      // Create an empty project
      const secondProject = await createTestProject(service, container, 'second');
      await createTestForm(service, container, testData.forms.simple, secondProject);

      const res = await container.Analytics.previewMetrics();

      const { id, ...firstDataset } = res.projects[0].datasets[0];
      const { id: _, ...secondDataset } = res.projects[0].datasets[1];

      firstDataset.should.be.eql({
        num_properties: 2,
        num_creation_forms: 2,
        num_followup_forms: 1,
        num_entities: {
          total: 5, // made one Entity ancient
          recent: 4 // 2 from submissions, 3 from bulk uploads
        },
        num_failed_entities: { // two Submissions failed due to invalid UUID
          total: 2, // made one Error ancient
          recent: 1
        },
        num_entity_updates: {
          total: 3,
          recent: 2
        },
        num_entity_updates_sub: {
          total: 1,
          recent: 1
        },
        num_entity_updates_api: {
          total: 2,
          recent: 1
        },
        num_entity_creates_sub: {
          total: 2,
          recent: 2
        },
        num_entity_creates_api: {
          total: 0,
          recent: 0
        },
        num_entity_creates_bulk: {
          total: 3,
          recent: 3
        },
        num_entities_updated: {
          total: 1,
          recent: 1
        },
        num_entity_conflicts: 1,
        num_entity_conflicts_resolved: 1,
        num_bulk_create_events: {
          total: 1,
          recent: 1
        },
        biggest_bulk_upload: 3
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
        },
        num_entity_updates: {
          total: 0,
          recent: 0
        },
        num_entity_updates_sub: {
          total: 0,
          recent: 0
        },
        num_entity_updates_api: {
          total: 0,
          recent: 0
        },
        num_entity_creates_sub: {
          total: 2,
          recent: 2
        },
        num_entity_creates_api: {
          total: 0,
          recent: 0
        },
        num_entity_creates_bulk: {
          total: 0,
          recent: 0
        },
        num_entities_updated: {
          total: 0,
          recent: 0
        },
        num_entity_conflicts: 0,
        num_entity_conflicts_resolved: 0,
        num_bulk_create_events: {
          total: 0,
          recent: 0
        },
        biggest_bulk_upload: 0
      });

      // Assert that a Project without a Dataset returns an empty array
      res.projects[1].datasets.should.be.eql([]);
    }));
  });

  describe('latest analytics audit log utility', () => {
    it('should find recently created analytics audit log', testService(async (service, container) => {
      await container.Audits.log(null, 'analytics', null, { test: 'foo', success: true });
      const res = await container.Analytics.getLatestAudit().then((o) => o.get());
      res.details.test.should.equal('foo');
    }));

    it('should find nothing if no analytics audit log', testService(async (service, container) => {
      const res = await container.Analytics.getLatestAudit();
      res.isEmpty().should.equal(true);
    }));

    it('should find analytics audit log created 30 days ago', testService(async (service, container) => {
      await container.Audits.log(null, 'analytics', null, { test: 'foo', success: true });
      await container.all(sql`update audits set "loggedAt" = current_timestamp - interval '30 days' where action = 'analytics'`);
      const res = await container.Analytics.getLatestAudit();
      res.isDefined().should.equal(true);
    }));

    it('should not return analytics audit log more than 30 days prior', testService(async (service, container) => {
      await container.Audits.log(null, 'analytics', null, { test: 'foo', success: true });
      await container.all(sql`update audits set "loggedAt" = current_timestamp - interval '31 days' where action = 'analytics'`);
      const res = await container.Analytics.getLatestAudit();
      res.isEmpty().should.equal(true);
    }));
  });
});

