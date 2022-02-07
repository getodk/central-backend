const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const config = require('config');
const { testServiceFullTrx } = require('../setup');
const { sql } = require('slonik');
const { connect } = require(appRoot + '/lib/model/migrate');
const migrator = connect(config.get('test.database'));
const testData = require('../../data/xml');
const populateUsers = require('../fixtures/01-users.js');
const populateForms = require('../fixtures/02-forms.js');


const upToMigration = async (toName) => {
  await migrator.raw('drop owned by current_user');
  while (true) {
    await migrator.migrate.up({ directory: appRoot + '/lib/model/migrations' });
    const migrations = await migrator.migrate.list({ directory: appRoot + '/lib/model/migrations' });
    const applied = migrations[0];
    const remaining = migrations[1];
    if (toName === applied[applied.length - 1]) break;
    if (remaining.length === 0) {
      console.log("Could not find migration", toName);
      break;
    }
  }
}

describe('database migrations', function() {
  this.timeout(4000);

  it('should purge deleted forms via migration', testServiceFullTrx(async (service, container) => {
    await upToMigration('20220121-01-form-cascade-delete.js');

    await populateUsers(container);
    await populateForms(container);
    
    await service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200));

    // running migration 20220121-02-purge-deleted-forms.js
    await migrator.migrate.up({ directory: appRoot + '/lib/model/migrations' });

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
    await migrator.migrate.up({ directory: appRoot + '/lib/model/migrations' });

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
    await migrator.migrate.up({ directory: appRoot + '/lib/model/migrations' });

    count = await container.oneFirst(sql`select count(*) from blobs`);
    count.should.equal(0); // blobs should all be purged
  }));
});