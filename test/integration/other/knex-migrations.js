/*
 * WARNING: DEPRECATED
 *
 * Database migration tests should be added in test/db-migrations/,
 * and should not follow the patterns in this file.
 *
 * WARNING: DEPRECATED
 */

const appRoot = require('app-root-path');
const uuid = require('uuid').v4;
const config = require('config');
const { testContainerFullTrx, testServiceFullTrx } = require('../setup');
const { sql } = require('slonik');
const { Actor, Config } = require(appRoot + '/lib/model/frames');
const { withKnex } = require(appRoot + '/lib/model/knex-migrator');

const testData = require('../../data/xml');
const populateUsers = require('../fixtures/01-users');
const { getFormFields } = require('../../../lib/data/schema');

const withTestDatabase = withKnex(config.get('test.database'));
const migrationsDir = appRoot + '/lib/model/migrations';
const upToMigration = (toName, inclusive = true) => withTestDatabase(async (migrator) => {
  await migrator.raw('drop owned by current_user');
  const migrations = await migrator.migrate.list({ directory: migrationsDir });
  const pending = migrations[1].map(({ file }) => file);
  const index = pending.indexOf(toName);
  if (index === -1) throw new Error(`Could not find migration ${toName}`);
  const end = inclusive ? index + 1 : index;
  for (let i = 0; i < end; i += 1)
    // eslint-disable-next-line no-await-in-loop
    await migrator.migrate.up({ directory: migrationsDir });
  // Confirm that the migrations completed as expected.
  const [completed] = await migrator.migrate.list({ directory: migrationsDir });
  completed.should.eql(pending.slice(0, end));
});
const up = () => withTestDatabase((migrator) =>
  migrator.migrate.up({ directory: migrationsDir }));

const testMigration = (filename, tests, options = {}) => {
  const { only = false, skip = false } = options;
  const f = only
    // eslint-disable-next-line no-only-tests/no-only-tests
    ? describe.only.bind(describe)
    : (skip ? describe.skip.bind(describe) : describe);
  f(`database migrations: ${filename}`, function() {
    this.timeout(20000);

    beforeEach(() => upToMigration(filename, false));

    tests.call(this);
  });
};
testMigration.only = (filename, tests) =>
  testMigration(filename, tests, { only: true });
testMigration.skip = (filename, tests) =>
  testMigration(filename, tests, { skip: true });

describe('database migrations: removing default project', function() {
  this.timeout(8000);

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

// skipped: test setup relies on populateUsers(), which relies on application
// code which has changed since the test was written.
// REVIEW: this test will never work again, and should probably be deleted.
describe.skip('database migrations: intermediate form schema', function() {
  this.timeout(20000);

  it('should test migration', testServiceFullTrx(async (service, container) => {
    // before 20230109-01-add-form-schema.js
    await upToMigration('20230106-01-remove-revision-number.js');
    await populateUsers(container);

    const createForm = async (xmlFormId) => {
      const formActeeId = uuid();
      await container.run(sql`insert into actees ("id", "species") values (${formActeeId}, 'form')`);
      const newForm = await container.all(sql`insert into forms ("projectId", "acteeId", "xmlFormId")
        values (1, ${formActeeId}, ${xmlFormId})
        returning "id"`);
      return newForm[0].id;
    };

    const createFormDef = async (formId, name, version, xml) => {
      const newFormDef = await container.all(sql`insert into form_defs
      ("formId", "name", "version", "xml", "hash", "sha", "sha256")
      values (${formId}, ${name}, ${version}, ${xml}, 'hash', 'sha', 'sha256')
      returning "id"`);
      const formDefId = newFormDef[0].id;

      const fields = await getFormFields(xml);
      for (const field of fields) {
        // eslint-disable-next-line no-await-in-loop
        await container.run(sql`insert into form_fields ("formId", "formDefId", "path", "name", "type", "order")
        values (${formId}, ${formDefId}, ${field.path}, ${field.name}, ${field.type}, ${field.order})`);
      }
      return formDefId;
    };

    const createDataset = async (name) => {
      const datasetActeeId = uuid();
      const newDataset = await container.all(sql`insert into datasets
      ("acteeId", "name", "projectId", "createdAt")
      values (${datasetActeeId}, ${name}, 1, now())
      returning "id"`);
      return newDataset[0].id;
    };

    const createDsProperties = async (dsId, formDefId, xml) => {
      const fields = await getFormFields(xml);
      for (const field of fields) {
        if (field.propertyName) {
          // eslint-disable-next-line no-await-in-loop
          let propId = await container.maybeOne(sql`select id from ds_properties
          where "name"=${field.propertyName} and "datasetId"=${dsId}`);
          if (propId.isDefined())
            propId = propId.get().id;
          else {
            // eslint-disable-next-line no-await-in-loop
            propId = await container.all(sql`insert into ds_properties
            ("name", "datasetId")
            values (${field.propertyName}, ${dsId})
            returning "id"`);
            propId = propId[0].id;
          }
          // eslint-disable-next-line no-await-in-loop
          await container.run(sql`insert into ds_property_fields
          ("dsPropertyId", "formDefId", "path")
          values (${propId}, ${formDefId}, ${field.path})`);
        }
      }
    };

    // Basic form with 3 defs, 2 different versions
    const id1 = await createForm('form1');
    await createFormDef(id1, 'Form 1', 1, testData.forms.simple);
    await createFormDef(id1, 'Form 1', 2, testData.forms.simple);
    await createFormDef(id1, 'Form 1', 3, testData.forms.simple.replace(/name/g, 'nickname'));

    // Dataset form with 3 defs, version A, B, A (should turn into 3 separate schemas)
    const datasetId = await createDataset('people');
    const id2 = await createForm('form2');

    const defId1 = await createFormDef(id2, 'Form 2', 1, testData.forms.simpleEntity);
    await container.all(sql`insert into dataset_form_defs ("datasetId", "formDefId") values (${datasetId}, ${defId1})`);
    await createDsProperties(datasetId, defId1, testData.forms.simpleEntity);

    const newFormVersion = testData.forms.simpleEntity.replace(/age/g, 'favorite_color');
    const defId2 = await createFormDef(id2, 'Form 2', 2, newFormVersion);
    await container.all(sql`insert into dataset_form_defs ("datasetId", "formDefId") values (${datasetId}, ${defId2})`);
    await createDsProperties(datasetId, defId2, newFormVersion);

    const defId3 = await createFormDef(id2, 'Form 2', 3, newFormVersion);
    await container.all(sql`insert into dataset_form_defs ("datasetId", "formDefId") values (${datasetId}, ${defId3})`);
    await createDsProperties(datasetId, defId3, newFormVersion);

    // Checking field count of basic form before applying migration
    let fieldCount = await container.one(sql`select count(*) from form_fields where "formId" = ${id1}`);
    fieldCount.count.should.equal(12); // three versions x four fields

    // Checking field count of dataset form
    fieldCount = await container.one(sql`select count(*) from form_fields where "formId" = ${id2}`);
    fieldCount.count.should.equal(18); // three versions x six fields

    // migration to add intermediate form schemas
    await up();

    let res;

    res = await container.one(sql`select count(*) from form_schemas`);
    res.count.should.equal(4);

    res = await container.one(sql`select count(*) from form_defs`);
    res.count.should.equal(6);

    // Checking field count of basic form after applying migration
    fieldCount = await container.one(sql`select count(*) from form_fields where "formId" = ${id1}`);
    fieldCount.count.should.equal(8);

    // Checking field count of dataset form
    fieldCount = await container.one(sql`select count(*) from form_fields where "formId" = ${id2}`);
    fieldCount.count.should.equal(12); // two x six;

    // Counting dataset-related rows in different tables
    res = await container.one(sql`select count(*) from ds_properties`);
    res.count.should.equal(3); // 3 dataset properties (first_name, age, favorite_color)

    res = await container.one(sql`select count(*) from ds_property_fields`);
    res.count.should.equal(6); // ds_property_fields not collapsed

    res = await container.one(sql`select count(distinct "schemaId") from ds_property_fields`);
    res.count.should.equal(2); // only 2 schema IDs represented here
  }));
});

describe('database migrations: 20230123-01-remove-google-backups', function() {
  this.timeout(20000);

  beforeEach(() => upToMigration('20230123-01-remove-google-backups.js', false));

  it('deletes backups configs', testContainerFullTrx(async ({ Configs }) => {
    await Configs.set('backups.main', { a: 'b' });
    await Configs.set('backups.google', { c: 'd' });
    await Configs.set('analytics', { enabled: false });
    await up();
    (await Configs.get('backups.main')).isEmpty().should.be.true();
    (await Configs.get('backups.google')).isEmpty().should.be.true();
    (await Configs.get('analytics')).isDefined().should.be.true();
  }));

  describe('backup creation token', () => {
    // Much of this was copied from the old endpoint
    // /v1/config/backups/initiate.
    const createToken = async ({ Actors, Assignments, Sessions }) => {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);
      const actor = await Actors.create(new Actor({
        type: 'singleUse',
        displayName: 'Backup creation token',
        expiresAt,
        meta: {
          keys: { some: 'data' }
        }
      }));
      await Assignments.grantSystem(actor, 'initbkup', Config.species);
      await Sessions.create(actor);
      return actor.id;
    };

    // skipped: test setup relies on createToken(), which relies on application
    // code which has changed since the test was written.
    // REVIEW: this test will never work again, and should probably be deleted.
    it.skip('consumes a token', testContainerFullTrx(async (container) => {
      const actorId = await createToken(container);
      const { one } = container;
      const count = () => one(sql`SELECT
        (SELECT count(*) FROM actors WHERE id = ${actorId} AND "deletedAt" IS NOT NULL) AS "deletedActors",
        (SELECT count(*) FROM assignments WHERE "actorId" = ${actorId}) AS assignments,
        (SELECT count(*) FROM sessions WHERE "actorId" = ${actorId}) AS sessions`);
      (await count()).should.eql({
        deletedActors: 0,
        assignments: 1,
        sessions: 1
      });
      await up();
      (await count()).should.eql({
        deletedActors: 1,
        assignments: 0,
        sessions: 0
      });
    }));
  });

  it('deletes the role that grants backup.verify', testContainerFullTrx(async ({ Roles }) => {
    const rolesBefore = await Roles.getAll();
    const canVerify = rolesBefore.filter(({ verbs }) =>
      verbs.includes('backup.verify'));
    canVerify.length.should.equal(1);
    canVerify[0].system.should.equal('initbkup');
    await up();
    const rolesAfter = await Roles.getAll();
    const deleted = rolesBefore.filter(roleBefore =>
      !rolesAfter.some(roleAfter => roleAfter.id === roleBefore.id));
    deleted.length.should.equal(1);
    deleted[0].system.should.equal('initbkup');
  }));
});
