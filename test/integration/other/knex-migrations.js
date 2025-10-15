const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const uuid = require('uuid').v4;
const config = require('config');
const { testContainerFullTrx, testServiceFullTrx } = require('../setup');
const { sql } = require('slonik');
const { createReadStream } = require('fs');
const { Actor, Config } = require(appRoot + '/lib/model/frames');
const { withKnex } = require(appRoot + '/lib/model/knex-migrator');
const { exhaust } = require(appRoot + '/lib/worker/worker');

const testData = require('../../data/xml');
const populateUsers = require('../fixtures/01-users');
const populateForms = require('../fixtures/02-forms');
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
const down = () => withTestDatabase((migrator) =>
  migrator.migrate.down({ directory: migrationsDir }));

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

// NOTE/TODO: figure out something else here D:
// Skipping these migrations because after adding a new description
// column to projects and forms, it is not possible to migrate part way
// (before the new column) and populate the data when frames expect the
// new column to exist.
describe.skip('database migrations', function() {
  this.timeout(8000);

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

describe('database migrations: intermediate form schema', function() {
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

    it('consumes a token', testContainerFullTrx(async (container) => {
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

    it.skip('does not modify other actor data', testServiceFullTrx(async (service, container) => {
      await populateUsers(container);
      await service.login('alice');
      await createToken(container);
      const { one } = container;
      const count = () => one(sql`SELECT
        (SELECT count(*) FROM actors where "deletedAt" is not null) AS "deletedActors",
        (SELECT count(*) FROM assignments) AS assignments,
        (SELECT count(*) FROM sessions) AS sessions`);
      (await count()).should.eql({
        deletedActors: 0,
        assignments: 3,
        sessions: 2
      });
      await up();
      // The counts decrease in the way that we would expect from the previous
      // test.
      (await count()).should.eql({
        deletedActors: 1,
        assignments: 2,
        sessions: 1
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

describe.skip('database migrations: 20230324-01-edit-dataset-verbs.js', function () {
  this.timeout(20000);

  it('should add dataset/entity read verbs with raw sql', testServiceFullTrx(async (service, container) => {
    await upToMigration('20230324-01-edit-dataset-verbs.js', false);
    await populateUsers(container);
    await populateForms(container);

    let admin = await container.one(sql`select verbs from roles where system = 'admin'`);
    admin.verbs.should.not.containDeep(['dataset.read', 'entity.read', 'entity.create', 'entity.update']);
    admin.verbs.length.should.equal(43);

    let viewer = await container.one(sql`select verbs from roles where system = 'viewer'`);
    viewer.verbs.should.not.containDeep(['dataset.read', 'entity.read', 'entity.create', 'entity.update']);
    viewer.verbs.length.should.equal(7);

    await up();

    admin = await container.one(sql`select verbs from roles where system = 'admin'`);
    admin.verbs.should.containDeep(['dataset.read', 'entity.read', 'entity.create', 'entity.update']);
    admin.verbs.length.should.equal(47);

    viewer = await container.one(sql`select verbs from roles where system = 'viewer'`);
    viewer.verbs.should.containDeep(['dataset.read', 'entity.read']);
    viewer.verbs.should.not.containDeep(['entity.create', 'entity.update']);
    viewer.verbs.length.should.equal(9);

    await down();

    admin = await container.one(sql`select verbs from roles where system = 'admin'`);
    admin.verbs.length.should.equal(43);
    viewer = await container.one(sql`select verbs from roles where system = 'viewer'`);
    viewer.verbs.length.should.equal(7);
  }));
});

describe.skip('database migrations from 20230406: altering entities and entity_defs', function () {
  this.timeout(20000);

  const createEntity = async (service, container) => {
    // Get bob's id because bob is going to be the one who
    // submits the submission
    const creatorId = await service.login('bob', (asBob) =>
      asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id));

    await service.login('bob', (asBob) =>
      asBob.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(testData.instances.simple.one)
        .expect(200));

    // Get the submission def id we just submitted.
    // For this test, it doesn't have to be a real entity submission.
    const subDef = await container.one(sql`SELECT id, "userAgent" FROM submission_defs WHERE "instanceId" = 'one' LIMIT 1`);

    // Make sure there is a dataset for the entity to be part of.
    const newDataset = await container.one(sql`
    INSERT INTO datasets
    ("acteeId", "name", "projectId", "createdAt")
    VALUES (${uuid()}, 'trees', 1, now())
    RETURNING "id"`);

    // Create the entity.
    // The root entity creator wont change in this migration though it should be
    // the same as the submitter id.
    const newEntity = await container.one(sql`
    INSERT INTO entities (uuid, "datasetId", "label", "creatorId", "createdAt")
    VALUES (${uuid()}, ${newDataset.id}, 'some label', ${creatorId}, now())
    RETURNING "id"`);

    // Create the entity def and link it to the submission def above.
    await container.run(sql`
    INSERT INTO entity_defs ("entityId", "createdAt", "current", "submissionDefId", "data")
    VALUES (${newEntity.id}, now(), true, ${subDef.id}, '{}')`);

    return { subDef, newEntity, creatorId };
  };

  it('should set entity def creator id and user agent from submission def', testServiceFullTrx(async (service, container) => {
    await upToMigration('20230406-01-add-entity-def-fields.js', false);
    await populateUsers(container);
    await populateForms(container);

    const { subDef, newEntity, creatorId } = await createEntity(service, container);

    // Apply the migration!!
    await up();

    // Look up the entity def again
    const entityDef = await container.one(sql`SELECT * FROM entity_defs WHERE "entityId" = ${newEntity.id} LIMIT 1`);

    // The creatorId and userAgent should now exist and be set.
    entityDef.creatorId.should.equal(creatorId);
    entityDef.userAgent.should.equal(subDef.userAgent);

    await down();
  }));

  it('should move the entity label to the entity_def table', testServiceFullTrx(async (service, container) => {
    await upToMigration('20230406-01-add-entity-def-fields.js', false);
    await populateUsers(container);
    await populateForms(container);

    const { newEntity } = await createEntity(service, container);

    // test entity had to be made before applying this migration because of not null creatorId constraint
    await up(); // applying 20230406-02-move-entity-label-add-deletedAt.js

    // Apply the migration!!
    await up();

    // Should be able to set deleted at timestamp
    await container.run(sql`UPDATE entities SET "deletedAt" = now() WHERE "id" = ${newEntity.id}`);

    // Look up the entity def again
    const entityDef = await container.one(sql`SELECT * FROM entity_defs WHERE "entityId" = ${newEntity.id} LIMIT 1`);
    const entity = await container.one(sql`SELECT * FROM entities WHERE "id" = ${newEntity.id} LIMIT 1`);

    // The label should now be on the entity def
    (entity.label == null).should.equal(true);
    entityDef.label.should.equal('some label');

    // Should be able to see the deletedAt timestamp
    entity.deletedAt.should.not.be.null();


    await down();
  }));
});

describe('database migrations from 20230512: adding entity_def_sources table', function () {
  this.timeout(20000);

  it.skip('should backfill entityId and entityDefId in audit log', testServiceFullTrx(async (service, container) => {
    await upToMigration('20230512-02-backfill-entity-id.js', false); // actually this is the previous migration
    await populateUsers(container);
    await populateForms(container);
    const asAlice = await service.login('alice');
    const creatorId = await asAlice.get('/v1/users/current').then(({ body }) => body.id);

    const datasetActeeId = uuid();
    await container.run(sql`insert into actees ("id", "species") values (${datasetActeeId}, 'dataset')`);

    const newDataset = await container.one(sql`
    INSERT INTO datasets ("acteeId", "name", "projectId", "createdAt")
    VALUES (${datasetActeeId}, 'trees', 1, now()) RETURNING "id", "acteeId"`);

    const newEntity = await container.one(sql`
    INSERT INTO entities (uuid, "datasetId", "creatorId", "createdAt")
    VALUES (${uuid()}, ${newDataset.id}, ${creatorId}, now())
    RETURNING "id", "uuid"`);

    // Create the entity def and link it to the submission def above.
    // eslint-disable-next-line no-await-in-loop
    const newDef = await container.one(sql`
    INSERT INTO entity_defs ("entityId", "createdAt", "creatorId", "current", "submissionDefId", "label", "data", "root")
    VALUES (${newEntity.id}, now(), ${creatorId}, true, null, 'some label', '{}', true)
    returning "id"`);

    const eventDetails = { entity: { uuid: newEntity.uuid, label: newEntity.label } };
    // eslint-disable-next-line no-await-in-loop
    await container.run(sql`
    INSERT INTO audits ("actorId", "action", "acteeId", "details")
    VALUES (${creatorId}, 'entity.create', ${newDataset.acteeId}, ${JSON.stringify(eventDetails)})`);

    await up();

    const audits = await container.all(sql`select * from audits where action = 'entity.create'`);

    audits[0].details.entityId.should.equal(newEntity.id);
    audits[0].details.entityDefId.should.equal(newDef.id);
  }));

  it.skip('should migrate the submissionDefId source of an entity to new table with event links', testServiceFullTrx(async (service, container) => {
    await upToMigration('20230512-03-add-entity-source.js', false); // actually this is the previous migration
    await populateUsers(container);
    await populateForms(container);

    const asAlice = await service.login('alice');
    const creatorId = await asAlice.get('/v1/users/current').then(({ body }) => body.id);

    // ---- Create forms and submissions and submission events ----
    // Track submission instance ids -> approval event ids
    const subToEvent = {};

    // Create a submission and approval event. It doesn't have to be an entity submission because
    // we will manually link a dummy entity to this submission and event.
    await asAlice.post('/v1/projects/1/forms/simple/submissions')
      .set('Content-Type', 'application/xml')
      .send(testData.instances.simple.one)
      .expect(200);
    await asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
      .send({ reviewState: 'approved' })
      .expect(200);

    let event = await container.Audits.getLatestByAction('submission.update').then(o => o.get());
    subToEvent.one = event;

    // Create another submission that we will delete by deleting the form
    await asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
      .set('Content-Type', 'application/xml')
      .send(testData.instances.withrepeat.one)
      .expect(200);
    await asAlice.patch('/v1/projects/1/forms/withrepeat/submissions/rone')
      .send({ reviewState: 'approved' })
      .expect(200);

    event = await container.Audits.getLatestByAction('submission.update').then(o => o.get());
    subToEvent.rone = event;

    // Create another form and submission that we will delete by purging the form
    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.simple2)
      .expect(200);
    await asAlice.post('/v1/projects/1/forms/simple2/submissions')
      .set('Content-Type', 'application/xml')
      .send(testData.instances.simple2.one)
      .expect(200);
    await asAlice.patch('/v1/projects/1/forms/simple2/submissions/s2one')
      .send({ reviewState: 'approved' })
      .expect(200);
    event = await container.Audits.getLatestByAction('submission.update').then(o => o.get());
    subToEvent.s2one = event;
    await asAlice.patch('/v1/projects/1/forms/simple2/submissions/s2one')
      .send({ reviewState: 'rejected' })
      .expect(200);
    await asAlice.patch('/v1/projects/1/forms/simple2/submissions/s2one')
      .send({ reviewState: 'approved' }) // multiple approval events to work with here
      .expect(200);

    // Create a fourth submission on the first form that won't have an approval event
    // but will be linked to an entity (probably wont have happened but prior to this release
    // but still want migration to work)
    await asAlice.post('/v1/projects/1/forms/simple/submissions')
      .set('Content-Type', 'application/xml')
      .send(testData.instances.simple.two)
      .expect(200);

    // Create a fifth submission that will be deleted and wont have an approval event
    await asAlice.post('/v1/projects/1/forms/simple2/submissions')
      .set('Content-Type', 'application/xml')
      .send(testData.instances.simple2.two)
      .expect(200);

    // ----- Manually create entities to link to these submissions as sources ----

    // Make sure there is a dataset for the entity to be part of.
    const datasetActeeId = uuid();
    await container.run(sql`insert into actees ("id", "species") values (${datasetActeeId}, 'dataset')`);

    const newDataset = await container.one(sql`
    INSERT INTO datasets ("acteeId", "name", "projectId", "createdAt")
    VALUES (${datasetActeeId}, 'trees', 1, now()) RETURNING "id", "acteeId"`);

    const subDefs = await container.all(sql`SELECT id, "submissionId", "instanceId" FROM submission_defs`);

    const entityToSubDef = {};
    for (const subDef of subDefs) {
      // eslint-disable-next-line no-await-in-loop
      const newEntity = await container.one(sql`
      INSERT INTO entities (uuid, "datasetId", "creatorId", "createdAt")
      VALUES (${subDef.instanceId}, ${newDataset.id}, ${creatorId}, now())
      RETURNING "id", "uuid"`);

      // Create the entity def and link it to the submission def above.
      // eslint-disable-next-line no-await-in-loop
      const newDef = await container.one(sql`
      INSERT INTO entity_defs ("entityId", "createdAt", "creatorId", "current", "submissionDefId", "label", "data", "root")
      VALUES (${newEntity.id}, now(), ${creatorId}, true, ${subDef.id}, 'some label', '{}', true)
      RETURNING "id"`);

      const eventDetails = {
        entityId: newEntity.id,
        entityDefId: newDef.id,
        entity: { uuid: newEntity.uuid, label: newEntity.label },
        submissionId: subDef.submissionId, submissionDefId: subDef.id
      };
      // eslint-disable-next-line no-await-in-loop
      await container.run(sql`
      INSERT INTO audits ("actorId", "action", "acteeId", "details")
      VALUES (${creatorId}, 'entity.create', ${newDataset.acteeId}, ${JSON.stringify(eventDetails)})
      `);

      entityToSubDef[newEntity.uuid] = subDef;
    }

    const newEntity = await container.one(sql`
    INSERT INTO entities (uuid, "datasetId", "creatorId", "createdAt")
    VALUES ('no_sub', ${newDataset.id}, ${creatorId}, now())
    RETURNING "id", "uuid"`);

    // Create the entity def and link it to the submission def above.
    // eslint-disable-next-line no-await-in-loop
    await container.one(sql`
    INSERT INTO entity_defs ("entityId", "createdAt", "creatorId", "current", "submissionDefId", "label", "data", "root")
    VALUES (${newEntity.id}, now(), ${creatorId}, true, null, 'some label', '{}', true)
    RETURNING "id"`);
    entityToSubDef[newEntity.uuid] = null;

    // ----- Start deleting submisisons ----

    // simple2 is purged
    await asAlice.delete('/v1/projects/1/forms/simple2')
      .expect(200);

    await container.Forms.purge(true);

    // withrepeat is merely soft deleted so submission def is still there
    await asAlice.delete('/v1/projects/1/forms/withrepeat')
      .expect(200);

    // ----- Run the migration! ----
    await up();

    // ----- Inspect the migrationed entity sources
    const entityDefsWithSources = await container.all(sql`
    SELECT entities."uuid", entity_defs."entityId", entity_defs."id", entity_def_sources.*
    FROM entity_defs
    JOIN entity_def_sources on entity_defs."sourceId" = entity_def_sources.id
    JOIN entities on entity_defs."entityId" = entities.id`);

    const entityToSource = entityDefsWithSources.reduce(
      (acc, curr) => ({ ...acc, [curr.uuid]: curr }),
      {}
    );

    // the normal submission
    // and the soft-deleted submission (form deleted, submission def data still exists)
    for (const k of ['one', 'rone']) {
      entityToSource[k].submissionDefId.should.equal(entityToSubDef[k].id);
      entityToSource[k].auditId.should.equal(subToEvent[k].id);
      entityToSource[k].details.submission.instanceId.should.equal(entityToSubDef[k].instanceId);
    }

    // the submission was purged, but the event is still there
    (entityToSource.s2one.submissionDefId == null).should.equal(true);
    entityToSource.s2one.auditId.should.equal(subToEvent.s2one.id);
    entityToSource.s2one.details.submission.instanceId.should.equal('s2one');

    // the submission data exists and is linked, but there was no approval event to link
    // (probably wont happen)
    entityToSource.two.submissionDefId.should.equal(entityToSubDef.two.id);
    (entityToSource.two.auditId == null).should.equal(true);

    // most degenerate cases (probably wont happen):
    // no sub def was provided to entity at all (so no events to look up)
    // s2two was purged and there was no approval event for it, so no triggering event
    for (const k of ['no_sub', 's2two']) {
      (entityToSource[k].submissionDefId == null).should.equal(true);
      (entityToSource[k].auditId == null).should.equal(true);
    }

    await down();

    // should be three entity_defs with non-null submissionDefId reset
    // 6 entities total, two were linked to purged submissions, one was never linked to a submission
    const { count } = await container.one(sql`select count(*) from entity_defs where "submissionDefId" is not null`);
    count.should.equal(3);
  }));
});

describe('database migrations from 20230802: delete orphan submissions', function test() {
  this.timeout(20000);

  it.skip('should delete orphan draft Submissions', testServiceFullTrx(async (service, container) => {
    await upToMigration('20230518-01-add-entity-index-to-audits.js');
    await populateUsers(container);

    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.simple)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
      .set('Content-Type', 'application/xml')
      .send(testData.instances.simple.one)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
      .set('Content-Type', 'application/xml')
      .send(testData.instances.simple.two)
      .expect(200);

    // let's make first instance orphan
    await container.run(sql`DELETE FROM submission_defs WHERE "instanceId" = 'one'`);

    await up();

    await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
      .expect(200)
      .then(({ body }) => {
        body.length.should.be.eql(1);
        body[0].instanceId.should.be.eql('two');
      });

  }));
});

describe.skip('database migration: 20231002-01-add-conflict-details.js', function test() {
  this.timeout(20000);

  it('should update dataReceived and baseVersion of existing entity defs', testServiceFullTrx(async (service, container) => {
    await upToMigration('20231002-01-add-conflict-details.js', false);
    await populateUsers(container);
    await populateForms(container);

    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.simpleEntity)
      .expect(200);

    const dsId = await container.oneFirst(sql`select id from datasets limit 1`);

    // Create the entity in the DB directly because application code has changed.
    const newEntity = await container.one(sql`
    INSERT INTO entities (uuid, "datasetId", "creatorId", "createdAt")
    VALUES (${uuid()}, ${dsId}, 5, now())
    RETURNING "id"`);

    // Create two entity defs
    await container.run(sql`
      INSERT INTO entity_defs ("entityId", "createdAt", "creatorId", "current", "label", "data", "version")
      VALUES (${newEntity.id}, now(), 5, false, 'some label', '{"foo": "bar"}', 1)`);

    await container.run(sql`
      INSERT INTO entity_defs ("entityId", "createdAt", "creatorId", "current", "label", "data", "version")
      VALUES (${newEntity.id}, now(), 5, true, 'other label', '{"x": "y", "a": "b"}', 2)`);

    // run migration: fill in dataReceived and baseVersion based on existing version
    await up();

    const defs = await container.all(sql`select data, label, version, "baseVersion", "dataReceived" from entity_defs order by id`);
    defs[0].dataReceived.should.eql({ foo: 'bar', label: 'some label' });
    defs[0].should.have.property('baseVersion').which.is.eql(null);
    defs[1].dataReceived.should.eql({ a: 'b', x: 'y', label: 'other label' });
    defs[1].should.have.property('baseVersion').which.is.eql(1);
  }));
});

testMigration.skip('20240215-01-entity-delete-verb.js', () => {
  it('should add entity.delete verb to correct roles', testServiceFullTrx(async (service, container) => {
    await populateUsers(container);

    const verbsByRole = async () => {
      const asAlice = await service.login('alice');
      const { body: roles } = await asAlice.get('/v1/roles').expect(200);
      const bySystem = {};
      for (const role of roles) bySystem[role.system] = role.verbs;
      return bySystem;
    };

    const before = await verbsByRole();
    before.admin.length.should.equal(48);
    before.admin.should.not.containEql('entity.delete');
    before.manager.length.should.equal(33);
    before.manager.should.not.containEql('entity.delete');
    before.viewer.length.should.equal(9);
    before.viewer.should.not.containEql('entity.delete');

    await up();

    const after = await verbsByRole();
    after.admin.length.should.equal(49);
    after.admin.should.containEql('entity.delete');
    after.manager.length.should.equal(34);
    after.manager.should.containEql('entity.delete');
    after.viewer.length.should.equal(9);
    after.viewer.should.not.containEql('entity.delete');
  }));
});

testMigration.skip('20240215-02-dedupe-verbs.js', () => {
  it('should remove duplicate submission.update verb', testServiceFullTrx(async (service, container) => {
    await populateUsers(container);

    const verbsByRole = async () => {
      const asAlice = await service.login('alice');
      const { body: roles } = await asAlice.get('/v1/roles').expect(200);
      const bySystem = {};
      for (const role of roles) bySystem[role.system] = role.verbs;
      return bySystem;
    };

    const before = await verbsByRole();
    before.admin.length.should.equal(49);
    before.admin.filter(verb => verb === 'submission.update').length.should.equal(2);
    before.manager.length.should.equal(34);
    before.manager.filter(verb => verb === 'submission.update').length.should.equal(2);
    before.viewer.length.should.equal(9);

    await up();

    const after = await verbsByRole();
    after.admin.length.should.equal(48);
    after.admin.should.eqlInAnyOrder([...new Set(before.admin)]);
    after.manager.length.should.equal(33);
    after.manager.should.eqlInAnyOrder([...new Set(before.manager)]);
    after.viewer.length.should.equal(9);
  }));

  it('should result in unique verbs for all roles', testServiceFullTrx(async (service, container) => {
    await up();
    await populateUsers(container);
    const asAlice = await service.login('alice');
    const { body: roles } = await asAlice.get('/v1/roles').expect(200);
    for (const { verbs } of roles) verbs.should.eql([...new Set(verbs)]);
  }));
});

testMigration('20240914-02-remove-orphaned-client-audits.js', () => {
  it.skip('should remove orphaned client audits', testServiceFullTrx(async (service, container) => {
    await populateUsers(container);
    await populateForms(container);

    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .send(testData.forms.clientAudits)
      .expect(200);

    // Send the submission with the client audit attachment
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

    await exhaust(container);

    // there should be 8 total rows (5 + 3)
    let numClientAudits = await container.oneFirst(sql`select count(*) from client_audits`);
    numClientAudits.should.equal(8);

    // there should be 2 blobs
    let blobCount = await container.oneFirst(sql`select count(*) from blobs`);
    blobCount.should.equal(2);

    // delete one of the submissions
    await asAlice.delete('/v1/projects/1/forms/audits/submissions/one')
      .expect(200);

    // simulate purge without client audit purge
    await container.run(sql`delete from submissions
    where submissions."deletedAt" is not null`);

    // purge unattached blobs (will not purge any because one is still referenced)
    await container.Blobs.purgeUnattached(true);

    // blobs count should still be 2
    blobCount = await container.oneFirst(sql`select count(*) from blobs`);
    blobCount.should.equal(2);

    // client audits still equals 8 after purge (3 orphaned)
    numClientAudits = await container.oneFirst(sql`select count(*) from client_audits`);
    numClientAudits.should.equal(8);

    // clean up orphaned client audits
    await up();

    numClientAudits = await container.oneFirst(sql`select count(*) from client_audits`);
    numClientAudits.should.equal(3);

    // blob count will still be two
    blobCount = await container.oneFirst(sql`select count(*) from blobs`);
    blobCount.should.equal(2);

    // but next run of purging unattached blobs will purge one
    await container.Blobs.purgeUnattached(true);

    // blobs count should finally be 1
    blobCount = await container.oneFirst(sql`select count(*) from blobs`);
    blobCount.should.equal(1);
  }));

  testMigration('20241010-01-schedule-entity-form-upgrade.js', () => {
    it.skip('should schedule entity forms with spec version 2023.1.0 for upgrade to 2024.1.0', testServiceFullTrx(async (service, container) => {
      await populateUsers(container);
      await populateForms(container);

      const asAlice = await service.login('alice');

      // Upload one form with multiple versions
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft?ignoreWarnings=true')
        .send(testData.forms.updateEntity2023.replace('orx:version="1.0"', 'orx:version="2.0"'))
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish');

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft?ignoreWarnings=true')
        .send(testData.forms.updateEntity2023.replace('orx:version="1.0"', 'orx:version="3.0"'))
        .set('Content-Type', 'text/xml')
        .expect(200);

      // Upload another form that needs updating
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.updateEntity2023.replace('id="updateEntity"', 'id="updateEntity2"'))
        .expect(200);

      // Upload an entity form that doesn't really need updating but does have 'update' in the actions column
      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.offlineEntity)
        .expect(200);

      // Upload an entity form that does not need updating
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.simpleEntity2022)
        .expect(200);

      // Deleted forms and projects
      // Upload another form that needs updating but will be deleted
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.updateEntity2023.replace('id="updateEntity"', 'id="updateEntityDeleted"'))
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/updateEntityDeleted')
        .expect(200);

      // Create a new project
      const newProjectId = await asAlice.post('/v1/projects')
        .send({ name: 'NewDeletedProject' })
        .expect(200)
        .then(({ body }) => body.id);

      // Upload a form that needs updating to the new project
      await asAlice.post(`/v1/projects/${newProjectId}/forms?publish=true&ignoreWarnings=true`)
        .send(testData.forms.updateEntity2023)
        .expect(200);

      // Delete the new project
      await asAlice.delete(`/v1/projects/${newProjectId}`);

      // Mark forms for upgrade
      await up();

      // There should be a total of 3 forms flagged for upgrade:
      // The two 2023.1 forms that need to be migrated, and one newer 2024.1 form.
      // The latter form will get processed by the worker but it will realize there is
      // no work to do so it wont change anything.
      const audits = await container.oneFirst(sql`select count(*) from audits where action = 'upgrade.process.form.entities_version'`);
      audits.should.equal(3);

      // Run upgrade
      await exhaust(container);

      // Check the audit log
      await asAlice.get('/v1/audits')
        .expect(200)
        .then(({ body }) => {
          const actions = body.map(a => a.action);

          // worker may not always process forms in the same order
          actions.slice(0, 3).should.eqlInAnyOrder([
            'form.update.draft.replace', // updateEntity2 draft only
            'form.update.draft.replace', // updateEntity draft
            'form.update.publish', // updateEntity published version
          ]);

          // Three upgrade events will always be present, though
          actions.slice(3, 6).should.eql([
            'upgrade.process.form.entities_version',
            'upgrade.process.form.entities_version',
            'upgrade.process.form.entities_version'
          ]);
        });

      // First form that was upgraded: updateEntity
      // Published form looks good, shows version 2.0[upgrade]
      await asAlice.get('/v1/projects/1/forms/updateEntity.xml')
        .then(({ text }) => {
          text.should.equal(`<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity" orx:version="2.0[upgrade]">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
    </model>
  </h:head>
</h:html>`);
        });

      // Draft form looks good, shows version 3.0[upgrade]
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xml')
        .then(({ text }) => {
          text.should.equal(`<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity" orx:version="3.0[upgrade]">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
    </model>
  </h:head>
</h:html>`);
        });

      // Second form that was updated with only a draft version
      // Draft form XML looks good
      await asAlice.get('/v1/projects/1/forms/updateEntity2/draft.xml')
        .then(({ text }) => {
          text.should.equal(`<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity2" orx:version="1.0[upgrade]">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
    </model>
  </h:head>
</h:html>`);
        });

      // Third form was already at 2024.1 version so it did not change
      await asAlice.get('/v1/projects/1/forms/offlineEntity.xml')
        .then(({ text }) => text.should.equal(testData.forms.offlineEntity));
    }));
  });
});

testMigration('20241227-01-backfill-audit-entity-uuid.js', () => {
  it.skip('should update the format of detail for entity.delete audits', testServiceFullTrx(async (service, container) => {
    await populateUsers(container);
    await populateForms(container);

    const asAlice = await service.login('alice');

    // Create a dataset
    await asAlice.post('/v1/projects/1/datasets')
      .send({ name: 'people' });

    // Create an entity
    const _uuid = uuid();
    await asAlice.post(`/v1/projects/1/datasets/people/entities`)
      .send({
        uuid: _uuid,
        label: 'John Doe'
      })
      .expect(200);

    // Delete the entity
    await asAlice.delete(`/v1/projects/1/datasets/people/entities/${_uuid}`)
      .expect(200);

    // Update audit log to match the previous code where uuid is written at the root
    await container.run(sql`UPDATE audits SET details=${JSON.stringify({ uuid: _uuid })} WHERE action='entity.delete'`);

    // Check the details of audit log of entity.delete action
    await asAlice.get('/v1/audits?action=entity.delete')
      .expect(200)
      .then(({ body }) => {
        const [ audit ] = body;
        audit.details.should.be.eql({
          uuid: _uuid
        });
      });

    // Run the migration
    await up();

    // Check the details of audit log of entity.delete action
    await asAlice.get('/v1/audits?action=entity.delete')
      .expect(200)
      .then(({ body }) => {
        const [ audit ] = body;
        audit.details.should.be.eql({
          entity: { uuid: _uuid }
        });
      });
  }));
});
