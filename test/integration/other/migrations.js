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

    await migrator.migrate.up({ directory: appRoot + '/lib/model/migrations' });

    const count = await container.oneFirst(sql`select count(*) from forms`);
    count.should.equal(1); // only the withrepeat base test should exist
  }));
});