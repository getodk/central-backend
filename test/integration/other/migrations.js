const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const uuid = require('uuid/v4');
const config = require('config');
const { testServiceFullTrx } = require('../setup');
const { sql } = require('slonik');
// eslint-disable-next-line import/no-dynamic-require
const { withDatabase } = require(appRoot + '/lib/model/migrate');
const testData = require('../../data/xml');
const populateUsers = require('../fixtures/01-users');
const populateForms = require('../fixtures/02-forms');


const withTestDatabase = withDatabase(config.get('test.database'));
const migrationsDir = appRoot + '/lib/model/migrations';
const upToMigration = (toName) => withTestDatabase(async (migrator) => {
  await migrator.raw('drop owned by current_user');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    await migrator.migrate.up({ directory: migrationsDir });
    // eslint-disable-next-line no-await-in-loop
    const migrations = await migrator.migrate.list({ directory: migrationsDir });
    const applied = migrations[0];
    const remaining = migrations[1];
    if (toName === applied[applied.length - 1]) break;
    if (remaining.length === 0) {
      // eslint-disable-next-line no-console
      console.log('Could not find migration', toName);
      break;
    }
  }
});
const up = () => withTestDatabase((migrator) =>
  migrator.migrate.up({ directory: migrationsDir }));

// NOTE/TODO: figure out something else here D:
// Skipping these migrations because after adding a new description
// column to projects and forms, it is not possible to migrate part way
// (before the new column) and populate the data when frames expect the
// new column to exist.
// eslint-disable-next-line space-before-function-paren, func-names
describe.skip('database migrations', function() {
  this.timeout(4000);

  it('should purge deleted forms via migration', testServiceFullTrx(async (service, container) => {
    await upToMigration('20220121-01-form-cascade-delete.js');

    await populateUsers(container);
    await populateForms(container);

    await service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200));

    // running migration 20220121-02-purge-deleted-forms.js
    await up();

    const count = await container.oneFirst(sql`select count(*) from forms`);
    count.should.equal(1); // only the withrepeat base test should exist
  }));

  it('should not purge blobs that are still referenced', testServiceFullTrx(async (service, container) => {
    // An earlier version of this migration [20220121-02-purge-deleted-forms.js]
    // failed because it tried to purge blobs that were still being used as
    // xlsBlobIds on active form definitons.
    await upToMigration('20220121-01-form-cascade-delete.js');
    await populateUsers(container);
    await populateForms(container);

    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .expect(200));

    // running migration 20220121-02-purge-deleted-forms.js
    await up();

    const count = await container.oneFirst(sql`select count(*) from blobs`);
    count.should.equal(1); // the xls blob should still exist
  }));

  it('should purge blobs of deleted forms', testServiceFullTrx(async (service, container) => {
    // An earlier version of this migration [20220121-02-purge-deleted-forms.js]
    // failed because it tried to purge blobs that were still being used as
    // xlsBlobIds on active form definitons.
    await upToMigration('20220121-01-form-cascade-delete.js');
    await populateUsers(container);
    await populateForms(container);

    // xmlFormId of this xlsx form is 'simple2'
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .expect(200)
        .then(() => asAlice.delete('/v1/projects/1/forms/simple2') // Delete form
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
          .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
          .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
          .expect(201))
        .then(() => asAlice.delete('/v1/projects/1/forms/binaryType') // Delete form
          .expect(200)));

    let count = await container.oneFirst(sql`select count(*) from blobs`);
    count.should.equal(3); // xls blob and two file blobs

    // running migration 20220121-02-purge-deleted-forms.js
    await up();

    count = await container.oneFirst(sql`select count(*) from blobs`);
    count.should.equal(0); // blobs should all be purged
  }));

  it('should not purge certain form defs that are either published or active drafts', testServiceFullTrx(async (service, container) => {
    // 20220209-01-purge-unneeded-drafts.js
    await upToMigration('20220121-02-purge-deleted-forms.js');
    await populateUsers(container);
    await populateForms(container);

    // Creating form defs that should still be there after the purge
    // 1. published defs (withrepeat) (1)
    // 2. published def and new draft of simple (2)
    // 3. just a new draft of simple2 (1)
    // 4. defs in a managed encryption project (3)
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/draft')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Encrypted Proj' })
          .expect(200)
          .then(({ body }) => body.id))
        .then((newProjId) => asAlice.post(`/v1/projects/${newProjId}/forms?publish=true`)
          .send(testData.forms.simple)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post(`/v1/projects/${newProjId}/forms/simple/draft`)
            .expect(200))
          .then(() => asAlice.post(`/v1/projects/${newProjId}/key`)
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200))));

    const before = await container.oneFirst(sql`select count(*) from form_defs`);
    before.should.equal(7);

    // running migration 20220209-01-purge-unneeded-drafts.js
    await up();

    const after = await container.oneFirst(sql`select count(*) from form_defs`);
    after.should.equal(before); // no defs purged
  }));

  it('should purge unneeded form draft defs', testServiceFullTrx(async (service, container) => {
    // 20220209-01-purge-unneeded-drafts.js
    await upToMigration('20220121-02-purge-deleted-forms.js');
    await populateUsers(container);
    await populateForms(container);

    // There isn't a way to get the code to make unneeded drafts anymore
    // so we are trying to do it manually by taking one of the intermediate
    // (but not current) published defs and setting its publishedAt value to null.
    await service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/draft')
        .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
            .expect(200)))
        .then(() => container.run(sql`update form_defs set "publishedAt" = null where "formId" = 1 and "version" = '2'`)));

    const before = await container.oneFirst(sql`select count(*) from form_defs`);
    before.should.equal(4);

    // running migration 20220209-01-purge-unneeded-drafts.js
    await up();

    const after = await container.oneFirst(sql`select count(*) from form_defs`);
    after.should.equal(before - 1); // one purged
  }));

});

// eslint-disable-next-line space-before-function-paren, func-names
describe('datbase migrations: removing default project', function() {
  this.timeout(4000);

  it('should put old forms into project', testServiceFullTrx(async (service, container) => {
    // before 20181206-01-add-projects.js
    await upToMigration('20181012-01-add-submissions-createdat-index.js');

    // create a form to put in the default project
    const formActeeId = uuid();
    await container.run(sql`insert into actees ("id", "species") values (${formActeeId}, 'form')`);
    await container.run(sql`insert into forms ("acteeId", "name", "xmlFormId", "xml", "version")
      values (${formActeeId}, 'A Form', '123', '<xml></xml>', '1')`);

    // running migration 20181206-01-add-projects.js
    await up();

    // check projects and forms
    const projects = await container.all(sql`select * from projects`);
    projects.length.should.equal(1);

    const proj = projects[0];
    proj.name.should.equal('Forms you made before projects existed');

    const formCount = await container.oneFirst(sql`select count(*) from forms where "projectId"=${proj.id}`);
    formCount.should.equal(1);
  }));

  it('should not make a default project if no forms', testServiceFullTrx(async (service, container) => {
    // up to and including this default project migration
    await upToMigration('20181206-01-add-projects.js');

    // check projects and forms
    const projCount = await container.oneFirst(sql`select count(*) from projects`);
    projCount.should.equal(0);
  }));
});
