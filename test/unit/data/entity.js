const should = require('should');
const appRoot = require('app-root-path');
const assert = require('assert');
const { ConflictType, submissionXmlToEntityData } = require('../../../lib/data/entity');
const { Entity } = require('../../../lib/model/frames');
const { entityRepeatFieldsFor } = require(appRoot + '/test/util/schema');
const { normalizeUuid,
  extractLabelFromSubmission,
  extractBaseVersionFromSubmission,
  extractBranchIdFromSubmission,
  extractTrunkVersionFromSubmission,
  extractEntity,
  extractBulkSource,
  extractSelectedProperties,
  selectFields,
  diffEntityData,
  getDiffProp,
  getWithConflictDetails } = require(appRoot + '/lib/data/entity');
const testData = require(appRoot + '/test/data/xml');

describe('extracting and validating entities', () => {
  describe('helper functions', () => {
    describe('normalizeUuid', () => {
      it('should return uuid in standard v4 format', () =>
        normalizeUuid('12345678-1234-4123-8234-123456789abc').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return lowercase uuid', () =>
        normalizeUuid('12345678-1234-4123-8234-123456789ABC').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return uuid with uuid: prefix stripped', () =>
        normalizeUuid('uuid:12345678-1234-4123-8234-123456789abc').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return uuid with uupercase UUID: prefix stripped', () =>
        normalizeUuid('UUID:12345678-1234-4123-8234-123456789abc').should.equal('12345678-1234-4123-8234-123456789abc'));

      it('should return problem if null passed in as arg', () =>
        assert.throws(() => { normalizeUuid(null); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter uuid missing.');
          return true;
        }));

      it('should return problem if undefined passed in as arg', () =>
        assert.throws(() => { normalizeUuid(undefined); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter uuid missing.');
          return true;
        }));

      it('should return problem if invalid uuid passed in', () =>
        assert.throws(() => { normalizeUuid('this_is_not_a_valid_uuid'); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (uuid) to be (valid version 4 UUID)');
          return true;
        }));
    });

    describe('extractLabelFromSubmission', () => {
      it('should return label when creating new entity (create = 1)', () => {
        const entity = { system: { create: '1', label: 'the_label' } };
        extractLabelFromSubmission(entity).should.equal('the_label');
      });

      it('should return label when creating new entity (create = true)', () => {
        const entity = { system: { create: 'true', label: 'the_label' } };
        extractLabelFromSubmission(entity).should.equal('the_label');
      });

      it('should complain if label is missing when creating entity', () => {
        const entity = { system: { create: '1' } };
        assert.throws(() => { extractLabelFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      it('should complain if label is empty when creating entity', () => {
        const entity = { system: { create: '1', label: '' } };
        assert.throws(() => { extractLabelFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      it('should return null for label if updating and label not provided', () => {
        const entity = { system: { update: '1', } };
        should.not.exist(extractLabelFromSubmission(entity, { update: true }));
      });

      it('should return null for label if updating and label is empty', () => {
        const entity = { system: { update: '1', label: '' } };
        should.not.exist(extractLabelFromSubmission(entity, { update: true }));
      });

      it('should return null when label is missing, create and update are both true, but on the update path', () => {
        // could be an upsert entity with no label.
        // if the update failed, the creation would then fail because of the label.
        // system create/update are ignored.
        const entity = { system: { create: 'true', update: 'true' } };
        should.not.exist(extractLabelFromSubmission(entity, { update: true }));
      });

      it('should complain if label is empty, system create and update are both true, but on the create path', () => {
        const entity = { system: { create: '1', label: '' } };
        assert.throws(() => { extractLabelFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      // The 3 following cases shouldn't come up
      it('should return label when neither create nor update is specified', () => {
        const entity = { system: { unknown_action: 'true', label: 'the_label' } };
        extractLabelFromSubmission(entity, { action: 'foo' }).should.equal('the_label');
      });

      it('should return empty label when neither create nor update is specified', () => {
        const entity = { system: { unknown_action: 'true', label: '' } };
        extractLabelFromSubmission(entity, { action: 'foo' }).should.equal('');
      });

      it('should return null when label is null label when neither create nor update is specified', () => {
        const entity = { system: { unknown_action: 'true' } };
        should.not.exist(extractLabelFromSubmission(entity, { action: 'foo' }));
      });
    });

    describe('extractBaseVersionFromSubmission', () => {
      it('should extract integer base version when update is true', () => {
        const entity = { system: { baseVersion: '99' } };
        extractBaseVersionFromSubmission(entity, { update: true }).should.equal(99);
      });

      it('should extract base version even if create is true and update is not', () => {
        const entity = { system: { baseVersion: '99' } };
        extractBaseVersionFromSubmission(entity, { create: true }).should.equal(99);
      });

      it('should complain if baseVersion is missing when update is true', () => {
        const entity = { system: { update: '1' } };
        assert.throws(() => { extractBaseVersionFromSubmission(entity, { update: true }); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter baseVersion missing.');
          return true;
        });
      });

      it('not complain if baseVersion is missing when update is false and create is true', () => {
        const entity = { system: { } };
        // the create/update values do not get pulled from the entity system data here
        // but rather from the branch in the code that decides whether a create
        // or update is currently being attempted.
        should.not.exist(extractBaseVersionFromSubmission(entity, { create: true }));
      });

      it('should complain if baseVersion not an integer', () => {
        const entity = { system: { update: '1', baseVersion: 'ten' } };
        assert.throws(() => { extractBaseVersionFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (baseVersion) to be (integer)');
          return true;
        });
      });
    });

    describe('extractBranchIdFromSubmission', () => {
      it('should extract branchId as uuid', () => {
        const entity = { system: { branchId: 'dcd8906c-e795-45f8-8670-48e97ba79437' } };
        extractBranchIdFromSubmission(entity).should.equal('dcd8906c-e795-45f8-8670-48e97ba79437');
      });

      it('should complain if branchId is provided but is not a v4 uuid', () => {
        const entity = { system: { branchId: 'not-a-uuid' } };
        assert.throws(() => { extractBranchIdFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (branchId) to be (valid version 4 UUID)');
          return true;
        });
      });

      it('should return null for branch id if empty string', () => {
        const entity = { system: { branchId: '' } };
        should.not.exist(extractBranchIdFromSubmission(entity));
      });

      it('should return null for branch id not provided', () => {
        const entity = { system: { } };
        should.not.exist(extractBranchIdFromSubmission(entity));
      });
    });

    describe('extractTrunkVersionFromSubmission', () => {
      it('should extract trunkVersion', () => {
        const entity = { system: { trunkVersion: '4', branchId: 'dcd8906c-e795-45f8-8670-48e97ba79437' } };
        extractTrunkVersionFromSubmission(entity).should.equal(4);
      });

      it('should complain if trunkVersion is provided with invalid branchId', () => {
        const entity = { system: { trunkVersion: '1', branchId: 'not-a-uuid' } };
        assert.throws(() => { extractTrunkVersionFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.11);
          err.message.should.equal('Invalid input data type: expected (branchId) to be (valid version 4 UUID)');
          return true;
        });
      });

      it('should complain if trunkVersion is provided without branchId', () => {
        const entity = { system: { trunkVersion: '1' } };
        assert.throws(() => { extractTrunkVersionFromSubmission(entity); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter branchId missing.');
          return true;
        });
      });
    });
  });

  describe('extract entity from submission: submissionXmlToEntityData', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    describe('new entity', () => {
      it('should return entity data parsed from submission based on form fields', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.simpleEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.simpleEntity.one);
        should(result[0].data).eql({ first_name: 'Alice', age: '88' });
      });

      it('should return entity system data parsed from submission', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.simpleEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.simpleEntity.one);
        should(result[0].system).eql({
          create: '1',
          id: 'uuid:12345678-1234-4123-8234-123456789abc',
          label: 'Alice (88)',
          dataset: 'people',
          update: undefined,
          baseVersion: undefined,
          branchId: undefined,
          trunkVersion: undefined
        });
      });

      it('should get entity uuid without uuid: prefix', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.simpleEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.simpleEntity.one.replace('uuid:', ''));
        should(result[0].system).eql({
          create: '1',
          id: '12345678-1234-4123-8234-123456789abc',
          label: 'Alice (88)',
          dataset: 'people',
          update: undefined,
          baseVersion: undefined,
          branchId: undefined,
          trunkVersion: undefined
        });
      });

      it('should get create property of entity if create is "true"', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.simpleEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.simpleEntity.one.replace('create="1"', 'create="true"'));
        result[0].system.create.should.equal('true');
      });

      it('should get any value of create', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.simpleEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.simpleEntity.one.replace('create="1"', 'create="foo"'));
        result[0].system.create.should.equal('foo');
      });

      it('should get (but later ignore) baseVersion when it is provided with create instead of update', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.updateEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.updateEntity.one.replace('update="1"', 'create="1"'));
        should.not.exist(result[0].system.update);
        result[0].system.create.should.equal('1');
        result[0].system.baseVersion.should.equal('1');
      });
    });

    describe('update entity', () => {
      it('should return entity data parsed from submission based on form fields', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.updateEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.updateEntity.one);
        should(result[0].data).eql(Object.assign(Object.create(null), { first_name: 'Alicia', age: '85' }));
      });

      it('should return entity system data parsed from submission', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.updateEntity);
        const result = await submissionXmlToEntityData(structuralFields, entityFields, testData.instances.updateEntity.one);
        should(result[0].system).eql({
          create: undefined,
          id: '12345678-1234-4123-8234-123456789abc',
          label: 'Alicia (85)',
          dataset: 'people',
          update: '1',
          baseVersion: '1',
          branchId: undefined,
          trunkVersion: undefined
        });
      });
    });
  });

  describe('extract multiple entities from submission with repeats', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    describe('new entities in repeats', () => {
      // The following tests should cover the core form and entity parsing code for many different configurations
      // of entities within repeats and groups.
      // Each test prepares form for multi entity parsing by retrieving entity form fields and
      // structural form fields, all annotated by dataset.

      it('should return entities in repeat', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.repeatEntityTrees);

        // Fields relevant to dataset
        entityFields.filter(e => e.datasetId === 'trees').map(e => e.path).should.eql([
          '/tree',
          '/tree/species',
          '/tree/circumference',
          '/tree/meta/entity',
          '/tree/meta/entity/label'
        ]);

        // Use fields to parse entity data from submission
        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          testData.instances.repeatEntityTrees.one);

        entities.length.should.equal(2);
        entities.map(e => e.system.label).should.eql([ 'Pine', 'Oak' ]);
        entities.map(e => e.system.dataset).should.eql([ 'trees', 'trees' ]);
      });

      it('should return root entity and child entities in repeat', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.repeatEntityHousehold);

        // Fields relevant to people dataset
        entityFields.filter(e => e.datasetId === 'people').map(e => e.path).should.eql([
          '/members/person',
          '/members/person/name',
          '/members/person/age',
          '/members/person/meta/entity',
          '/members/person/meta/entity/label'
        ]);

        // Fields relevant to households dataset
        entityFields.filter(e => e.datasetId === 'households').map(e => e.path).should.eql([
          '/household_id',
          '/members/num_people',
          '/meta/entity',
          '/meta/entity/label'
        ]);

        // Use fields to parse entity data from submission
        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          testData.instances.repeatEntityHousehold.one);

        entities.length.should.eql(4);
        entities[0].should.eql(
          {
            system: {
              dataset: 'households',
              id: 'bdee1a6e-060c-47b7-9436-19296b0ded04',
              create: '1',
              update: undefined,
              baseVersion: undefined,
              trunkVersion: undefined,
              branchId: undefined,
              label: 'Household:1'
            },
            data: { hh_id: '1', count: '3' }
          },
        );
        entities[1].should.eql(
          {
            system: {
              dataset: 'people',
              id: '04f22514-654d-46e6-9d94-41676a5c97e1',
              create: '1',
              update: undefined,
              baseVersion: undefined,
              trunkVersion: undefined,
              branchId: undefined,
              label: 'parent1'
            },
            data: { full_name: 'parent1', age: '35' }
          },
        );
        entities[2].should.eql(
          {
            system: {
              dataset: 'people',
              id: '3b082d6c-dcc8-4d42-9fe3-a4e4e5f1bb0a',
              create: '1',
              update: undefined,
              baseVersion: undefined,
              trunkVersion: undefined,
              branchId: undefined,
              label: 'parent2'
            },
            data: { full_name: 'parent2', age: '37' }
          },
        );
        entities[3].should.eql(
          {
            system: {
              dataset: 'people',
              id: '33bc1b45-ab0e-4652-abcf-90926b6dc0a3',
              create: '1',
              update: undefined,
              baseVersion: undefined,
              trunkVersion: undefined,
              branchId: undefined,
              label: 'child1'
            },
            data: { full_name: 'child1', age: '12' }
          },
        );
      });

      it('should return entities in different levels but no repeats', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.multiEntityFarm);

        // Fields relevant to dataset
        entityFields.filter(e => e.datasetId === 'farms').map(e => e.path).should.eql([
          '/farm',
          '/farm/farm_id',
          '/farm/location',
          '/farm/acres',
          '/farm/meta/entity',
          '/farm/meta/entity/label'
        ]);

        entityFields.filter(e => e.datasetId === 'farmers').map(e => e.path).should.eql([
          '/farm/farmer',
          '/farm/farmer/farmer_name',
          '/farm/farmer/age',
          '/farm/farmer/meta/entity',
          '/farm/farmer/meta/entity/label'
        ]);

        // Use fields to parse entity data from submission
        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          testData.instances.multiEntityFarm.one);

        entities.length.should.equal(2);
        entities.map(e => e.system.label).should.eql([ 'Farm 123', 'Farmer Barb' ]);
        entities.map(e => e.system.dataset).should.eql([ 'farms', 'farmers' ]);

        // Spot check a few entities' data
        entities[0].data.acres.should.equal('30');
        entities[1].data.full_name.should.equal('Barb');
      });

      it('should return entities from two levels of repeats', async () => {
        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.nestedRepeatEntity);

        // Fields relevant to dataset
        entityFields.filter(e => e.datasetId === 'plots').map(e => e.path).should.eql([
          '/plot',
          '/plot/plot_id',
          '/plot/crop',
          '/plot/meta/entity',
          '/plot/meta/entity/label'
        ]);

        entityFields.filter(e => e.datasetId === 'trees').map(e => e.path).should.eql([
          '/plot/tree',
          '/plot/tree/species',
          '/plot/tree/health_status',
          '/plot/tree/meta/entity',
          '/plot/tree/meta/entity/label'
        ]);

        // Use fields to parse entity data from submission
        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          testData.instances.nestedRepeatEntity.one);

        // Two plots + two trees per plot
        entities.length.should.equal(6);
        entities.map(e => e.system.label).should.eql([
          'Plot 123: cherries',
          'Plot 333: apples',
          'Tree bing',
          'Tree rainier',
          'Tree gala',
          'Tree pink lady'
        ]);
        entities.map(e => e.system.dataset).should.eql([ 'plots', 'plots', 'trees', 'trees', 'trees', 'trees' ]);

        // Spot check a few entities' data
        entities[0].data.crop.should.equal('cherries');
        entities[3].data.species.should.equal('rainier');
      });

      it('should return entities from parallel repeats', async () => {
        const form = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
  <h:head>
    <h:title>Parallel Repeats</h:title>
    <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
      <instance>
        <data id="parallel_repeats" version="20250917094650">
          <tree>
            <tree_species/>
            <tree_health_status/>
            <meta>
              <entity dataset="trees" id="" create="1">
                <label/>
              </entity>
            </meta>
          </tree>
          <flower>
            <flower_species/>
            <flower_health_status/>
            <meta>
              <entity dataset="flowers" id="" create="1">
                <label/>
              </entity>
            </meta>
          </flower>
          <meta>
            <instanceID/>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/tree/tree_species" type="string" entities:saveto="species"/>
      <bind nodeset="/data/tree/tree_health_status" type="string" entities:saveto="health_status"/>
      <bind nodeset="/data/tree/meta/entity/@id" type="string" readonly="true()"/>
      <setvalue ref="/data/tree/meta/entity/@id" event="odk-instance-first-load odk-new-repeat" type="string" readonly="true()" value="uuid()"/>
      <bind nodeset="/data/tree/meta/entity/label" calculate="concat(&quot;Tree: &quot;,  ../../../tree_species )" type="string" readonly="true()"/>
      <bind nodeset="/data/flower/flower_species" type="string" entities:saveto="species"/>
      <bind nodeset="/data/flower/flower_health_status" type="string" entities:saveto="health_status"/>
      <bind nodeset="/data/flower/meta/entity/@id" type="string" readonly="true()"/>
      <setvalue ref="/data/flower/meta/entity/@id" event="odk-instance-first-load odk-new-repeat" type="string" readonly="true()" value="uuid()"/>
      <bind nodeset="/data/flower/meta/entity/label" calculate="concat(&quot;Flower: &quot;,  ../../../flower_species )" type="string" readonly="true()"/>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
    </model>
  </h:head>
  <h:body>
    <group ref="/data/tree">
      <label>Tree info</label>
      <repeat nodeset="/data/tree">
        <input ref="/data/tree/tree_species">
          <label>Tree Species</label>
        </input>
        <input ref="/data/tree/tree_health_status">
          <label>Tree Health</label>
        </input>
      </repeat>
    </group>
    <group ref="/data/flower">
      <label>Flower info</label>
      <repeat nodeset="/data/flower">
        <input ref="/data/flower/flower_species">
          <label>Tree Species</label>
        </input>
        <input ref="/data/flower/flower_health_status">
          <label>Tree Health</label>
        </input>
      </repeat>
    </group>
  </h:body>
</h:html>`;

        const sub = `<data
      xmlns:jr="http://openrosa.org/javarosa"
      xmlns:orx="http://openrosa.org/xforms" id="parallel_repeats" version="20250917094650">
      <tree>
        <tree_species>oak</tree_species>
        <tree_health_status>good</tree_health_status>
        <meta>
          <entity dataset="trees" id="d3edfdd2-d6cf-4d2f-9b0d-29b13d7ce2db" create="1">
            <label>Tree: oak</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <tree_species>willow</tree_species>
        <tree_health_status>bad</tree_health_status>
        <meta>
          <entity dataset="trees" id="eb05e114-6c4b-4351-b317-1523599fab73" create="1">
            <label>Tree: willow</label>
          </entity>
        </meta>
      </tree>
      <flower>
        <flower_species>tulip</flower_species>
        <flower_health_status>good</flower_health_status>
        <meta>
          <entity dataset="flowers" id="337a9379-d294-413c-a424-f10ae3859e12" create="1">
            <label>Flower: tulip</label>
          </entity>
        </meta>
      </flower>
      <flower>
        <flower_species>daisy</flower_species>
        <flower_health_status>good</flower_health_status>
        <meta>
          <entity dataset="flowers" id="4a9c4b62-4f41-498a-9a4d-212dad20d643" create="1">
            <label>Flower: daisy</label>
          </entity>
        </meta>
      </flower>
      <meta>
        <instanceID>uuid:85feea84-59a8-4252-b895-730cfb9153b2</instanceID>
      </meta>
    </data>`;

        const { entityFields, structuralFields } = await entityRepeatFieldsFor(form);

        // Fields relevant to dataset
        entityFields.filter(e => e.datasetId === 'trees').map(e => e.path).should.eql([
          '/tree',
          '/tree/tree_species',
          '/tree/tree_health_status',
          '/tree/meta/entity',
          '/tree/meta/entity/label'
        ]);

        entityFields.filter(e => e.datasetId === 'flowers').map(e => e.path).should.eql([
          '/flower',
          '/flower/flower_species',
          '/flower/flower_health_status',
          '/flower/meta/entity',
          '/flower/meta/entity/label'
        ]);

        // Use fields to parse entity data from submission
        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          sub);

        // two trees + two flowers
        entities.length.should.equal(4);
        entities.map(e => e.system.label).should.eql([ 'Tree: oak', 'Tree: willow', 'Flower: tulip', 'Flower: daisy' ]);
        entities.map(e => e.system.dataset).should.eql([ 'trees', 'trees', 'flowers', 'flowers' ]);
        // both entity types have species field so these are mixed between tree species and flower species
        entities.map(e => e.data.species).should.eql([ 'oak', 'willow', 'tulip', 'daisy' ]);
      });

      it('should return entities from a repeat / group', async () => {
        // This is kind of a weird form design where the entity declaration is within a repeat
        // but not associated with that repeat because it's in a group nested within the repeat.
        // But all the entities in the submission still get picked up.

        const { entityFields, structuralFields } = await entityRepeatFieldsFor(testData.forms.groupRepeatEntity);

        entityFields.filter(e => e.datasetId === 'trees').map(e => e.path).should.eql([
          '/tree/tree_details',
          '/tree/tree_details/species',
          '/tree/tree_details/health_status',
          '/tree/tree_details/meta/entity',
          '/tree/tree_details/meta/entity/label'
        ]);

        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          testData.instances.groupRepeatEntity.one);

        entities.length.should.eql(2);
        entities.map(e => e.system.dataset).should.eql([ 'trees', 'trees' ]);
        entities.map(e => e.system.label).should.eql([ 'Tree fig', 'Tree kumquat' ]);
        entities.map(e => e.data.species).should.eql([ 'fig', 'kumquat' ]);
      });

      it('should return entities from a doubly nested repeat with no outer entities', async () => {
        const form = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
  <h:head>
    <h:title>Entity in nested repeat</h:title>
    <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
      <instance>
        <data id="entity_nested_repeat" version="20250917093816">
          <plot>
            <tree>
              <species/>
              <health_status/>
              <meta>
                <entity dataset="trees" id="" create="1">
                  <label/>
                </entity>
              </meta>
            </tree>
          </plot>
          <meta>
            <instanceID/>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/plot/tree/species" type="string" entities:saveto="species"/>
      <bind nodeset="/data/plot/tree/health_status" type="string"/>
      <bind nodeset="/data/plot/tree/meta/entity/@id" type="string" readonly="true()"/>
      <setvalue ref="/data/plot/tree/meta/entity/@id" event="odk-instance-first-load odk-new-repeat" type="string" readonly="true()" value="uuid()"/>
      <bind nodeset="/data/plot/tree/meta/entity/label" calculate="&quot;Tree&quot;" type="string" readonly="true()"/>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
    </model>
  </h:head>
  <h:body>
    <group ref="/data/plot">
      <label>Outer Repeat</label>
      <repeat nodeset="/data/plot">
        <group ref="/data/plot/tree">
          <label>Inner Repeat</label>
          <repeat nodeset="/data/plot/tree">
            <input ref="/data/plot/tree/species">
              <label>Tree Species</label>
            </input>
            <input ref="/data/plot/tree/health_status">
              <label>Tree Health</label>
            </input>
          </repeat>
        </group>
      </repeat>
    </group>
  </h:body>
</h:html>`;

        const sub = `<data
    xmlns:jr="http://openrosa.org/javarosa"
    xmlns:orx="http://openrosa.org/xforms" id="entity_nested_repeat" version="20250917093816">
    <plot>
      <tree>
        <species>fir</species>
        <health_status>ok</health_status>
        <meta>
          <entity dataset="trees" id="a45cc990-1b0f-43b2-a042-6d6c57da7f7b" create="1">
            <label>Tree</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <species>pine</species>
        <health_status>bad</health_status>
        <meta>
          <entity dataset="trees" id="ca2c5a04-1b80-4a82-b265-f12d125febc1" create="1">
            <label>Tree</label>
          </entity>
        </meta>
      </tree>
    </plot>
    <plot>
      <tree>
        <species>apple</species>
        <health_status>good</health_status>
        <meta>
          <entity dataset="trees" id="80aa358d-6989-4c34-97f5-6087036d7c0b" create="1">
            <label>Tree</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <species>pear</species>
        <health_status>bad</health_status>
        <meta>
          <entity dataset="trees" id="a172bee9-002b-40d2-a216-a71d98ccc30d" create="1">
            <label>Tree</label>
          </entity>
        </meta>
      </tree>
    </plot>
    <meta>
      <instanceID>uuid:f9d9b462-bc1e-4e7c-bb56-23d4232064e0</instanceID>
    </meta>
  </data>`;

        const { entityFields, structuralFields } = await entityRepeatFieldsFor(form);

        entityFields.filter(e => e.datasetId === 'trees').map(e => e.path).should.eql([
          '/plot/tree',
          '/plot/tree/species',
          '/plot/tree/meta/entity',
          '/plot/tree/meta/entity/label'
        ]);

        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          sub);

        entities.length.should.eql(4);
        entities.map(e => e.system.dataset).should.eql([ 'trees', 'trees', 'trees', 'trees' ]);
        // Form didn't construct unique labels
        entities.map(e => e.system.label).should.eql([ 'Tree', 'Tree', 'Tree', 'Tree' ]);
        entities.map(e => e.data.species).should.eql([ 'fir', 'pine', 'apple', 'pear' ]);
      });

      it('should return multiple entities from repeat / group / repeat / group', async () => {
        const form = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
  <h:head>
    <h:title>Deeply Nested Entities in Repeats</h:title>
    <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
      <instance>
        <data id="deeply_nested_repeat_entities" version="20250916155723">
          <outer_repeat>
            <outer_group>
              <inner_repeat>
                <inner_group>
                  <species/>
                  <health_status/>
                  <meta>
                    <entity dataset="trees" id="" create="1">
                      <label/>
                    </entity>
                  </meta>
                </inner_group>
              </inner_repeat>
            </outer_group>
          </outer_repeat>
          <meta>
            <instanceID/>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/outer_repeat/outer_group/inner_repeat/inner_group/species" type="string" entities:saveto="species"/>
      <bind nodeset="/data/outer_repeat/outer_group/inner_repeat/inner_group/health_status" type="string"/>
      <bind nodeset="/data/outer_repeat/outer_group/inner_repeat/inner_group/meta/entity/@id" type="string" readonly="true()"/>
      <setvalue ref="/data/outer_repeat/outer_group/inner_repeat/inner_group/meta/entity/@id" event="odk-instance-first-load odk-new-repeat" type="string" readonly="true()" value="uuid()"/>
      <bind nodeset="/data/outer_repeat/outer_group/inner_repeat/inner_group/meta/entity/label" calculate="concat(&quot;Tree &quot;,  ../../../species )" type="string" readonly="true()"/>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
    </model>
  </h:head>
  <h:body>
    <group ref="/data/outer_repeat">
      <label>Outer Repeat</label>
      <repeat nodeset="/data/outer_repeat">
        <group ref="/data/outer_repeat/outer_group">
          <label>Outer Group</label>
          <group ref="/data/outer_repeat/outer_group/inner_repeat">
            <label>Inner Repeat</label>
            <repeat nodeset="/data/outer_repeat/outer_group/inner_repeat">
              <group ref="/data/outer_repeat/outer_group/inner_repeat/inner_group">
                <label>Inner Group</label>
                <input ref="/data/outer_repeat/outer_group/inner_repeat/inner_group/species">
                  <label>Tree Species</label>
                </input>
                <input ref="/data/outer_repeat/outer_group/inner_repeat/inner_group/health_status">
                  <label>Tree Health</label>
                </input>
              </group>
            </repeat>
          </group>
        </group>
      </repeat>
    </group>
  </h:body>
</h:html>`;

        const sub = `<data
    xmlns:jr="http://openrosa.org/javarosa"
    xmlns:orx="http://openrosa.org/xforms" id="deeply_nested_repeat_entities" version="20250916155723">
    <outer_repeat>
      <outer_group>
        <inner_repeat>
          <inner_group>
            <species>mango</species>
            <health_status>good</health_status>
            <meta>
              <entity dataset="trees" id="3bbe1c39-445a-4b51-831f-305222c52c42" create="1">
                <label>Tree mango</label>
              </entity>
            </meta>
          </inner_group>
        </inner_repeat>
        <inner_repeat>
          <inner_group>
            <species>apple</species>
            <health_status>ok</health_status>
            <meta>
              <entity dataset="trees" id="d50e5360-54d2-4219-a594-0efd884721f0" create="1">
                <label>Tree apple</label>
              </entity>
            </meta>
          </inner_group>
        </inner_repeat>
      </outer_group>
    </outer_repeat>
    <outer_repeat>
      <outer_group>
        <inner_repeat>
          <inner_group>
            <species>lime</species>
            <health_status>good</health_status>
            <meta>
              <entity dataset="trees" id="88c9ddc5-e171-4435-ab84-1ae3c209d4b5" create="1">
                <label>Tree lime</label>
              </entity>
            </meta>
          </inner_group>
        </inner_repeat>
      </outer_group>
    </outer_repeat>
    <meta>
      <instanceID>uuid:08487fb1-59ea-4df0-adb3-6c67e11484b3</instanceID>
    </meta>
  </data>`;

        const { entityFields, structuralFields } = await entityRepeatFieldsFor(form);

        entityFields.filter(e => e.datasetId === 'trees').map(e => e.path).should.eql([
          '/outer_repeat/outer_group/inner_repeat/inner_group',
          '/outer_repeat/outer_group/inner_repeat/inner_group/species',
          '/outer_repeat/outer_group/inner_repeat/inner_group/meta/entity',
          '/outer_repeat/outer_group/inner_repeat/inner_group/meta/entity/label'
        ]);

        const entities = await submissionXmlToEntityData(
          structuralFields, entityFields,
          sub);

        entities.length.should.eql(3);
        entities.map(e => e.system.dataset).should.eql([ 'trees', 'trees', 'trees' ]);
        entities.map(e => e.system.label).should.eql([ 'Tree mango', 'Tree apple', 'Tree lime' ]);
        entities.map(e => e.data.species).should.eql([ 'mango', 'apple', 'lime' ]);

      });
    });
  });

  describe('extract entity from API request: extractEntity', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    it('should reject if extra fields passed to body', () => {
      const body = {
        uuid: '12345678-1234-4123-8234-123456789abc',
        label: 'Alice (88)',
        data: { first_name: 'Alice' },
        extra: 'field'
      };
      const propertyNames = ['first_name'];
      assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
        err.problemCode.should.equal(400.31);
        err.message.should.equal('Expected parameters: (label, uuid, data). Got (uuid, label, data, extra).');
        return true;
      });
    });

    describe('new entities', () => {
      it('should parse new entity data', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Alice (88)',
          data: { age: '88', first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(body, propertyNames);
        should(entity).eql({
          system: {
            label: 'Alice (88)',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '88', first_name: 'Alice' }
        });
      });

      it('should parse subset of dataset properties and leave the rest undefined', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Alice (88)',
          data: { first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(body, propertyNames);
        should(entity).eql({
          system: {
            label: 'Alice (88)',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { first_name: 'Alice' }
        });
      });

      it('should reject if data contains unknown properties', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Label',
          data: { age: '88', favorite_food: 'pizza' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.28);
          err.message.should.equal('The entity is invalid. You specified the dataset property [favorite_food] which does not exist.');
          return true;
        });
      });

      it('should reject if label is blank', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: '',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.8);
          err.message.should.equal('Unexpected label value (empty string); Label cannot be blank.');
          return true;
        });
      });

      it('should reject if label is missing AND in create case (no existingEntity)', () => {
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
          err.problemCode.should.equal(400.2);
          err.message.should.equal('Required parameter label missing.');
          return true;
        });
      });

      it('should reject if required part of the request is null or not a string in create', () => {
        // These are JSON entity validation errors so they use a newer 400 bad request problem
        const requests = [
          [
            { uuid: '12345678-1234-4123-8234-123456789abc', label: 1234, data: { first_name: 'Alice' } },
            400.11,
            'Invalid input data type: expected (label) to be (string)'
          ],
          [
            { uuid: '12345678-1234-4123-8234-123456789abc', label: 'Label', data: { first_name: 'Alice', age: 99 } },
            400.11,
            'Invalid input data type: expected (age) to be (string)'
          ],
          [
            { uuid: '12345678-1234-4123-8234-123456789abc', label: 'Label', data: { first_name: 'Alice', age: null } },
            400.11,
            'Invalid input data type: expected (age) to be (string)'
          ],
          [
            { uuid: 123, label: 'Label', data: { first_name: 'Alice', age: 99 } },
            400.11,
            'Invalid input data type: expected (uuid) to be (string)'
          ]
        ];
        const propertyNames = ['age', 'first_name'];
        for (const [body, code, message] of requests) {
          assert.throws(() => { extractEntity(body, propertyNames); }, (err) => {
            err.problemCode.should.equal(code);
            err.message.should.match(message);
            return true;
          });
        }
      });
    });

    describe('updated entities', () => {
      it('should parse updated entity data', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { age: '88', first_name: 'Alice' }
        };
        const newData = {
          data: { age: '99', first_name: 'Alice' },
          label: 'New Label'
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(newData, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'New Label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '99', first_name: 'Alice' }
        });
      });

      it('should allow updating properties not included in earlier version of entity', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Label',
          },
          data: { first_name: 'Alice' }
        };
        const newData = {
          data: { age: '99' }
        };
        const propertyNames = ['age', 'first_name'];
        const entity = extractEntity(newData, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'Label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '99', first_name: 'Alice' }
        });
      });

      it('should allow only label to be updated without changing data', () => {
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const body = {
          label: 'New Label'
        };
        const propertyNames = ['first_name'];
        const entity = extractEntity(body, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'New Label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { first_name: 'Alice' }
        });
      });

      it('should allow label to be missing and use label of existing entity', () => {
        const existingEntity = { system: { uuid: '12345678-1234-4123-8234-123456789abc', label: 'previous_label' }, data: {} };
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        const entity = extractEntity(body, propertyNames, existingEntity);
        should(entity).eql({
          system: {
            label: 'previous_label',
            uuid: '12345678-1234-4123-8234-123456789abc'
          },
          data: { age: '88' }
        });
      });

      it('should reject if blank label provided in update', () => {
        const existingEntity = { system: { uuid: '12345678-1234-4123-8234-123456789abc', label: 'previous_label' }, data: {} };
        const body = {
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: '',
          data: { age: '88' }
        };
        const propertyNames = ['age'];
        assert.throws(() => { extractEntity(body, propertyNames, existingEntity); }, (err) => {
          err.problemCode.should.equal(400.8);
          err.message.should.match('Unexpected label value (empty string); Label cannot be blank.');
          return true;
        });
      });

      it('should reject if required part of the request is missing or not a string in update', () => {
        const requests = [
          [
            {},
            400.28, 'The entity is invalid. No entity data or label provided.'
          ],
          [
            { label: null },
            400.28, 'The entity is invalid. No entity data or label provided.'
          ],
          [
            { data: { first_name: 'Alice', age: 99 } },
            400.11, 'Invalid input data type: expected (age) to be (string)'
          ],
          [
            { data: { first_name: 'Alice', age: null } },
            400.11, 'Invalid input data type: expected (age) to be (string)'
          ],
        ];
        const existingEntity = {
          system: {
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Alice (88)',
          },
          data: { first_name: 'Alice' }
        };
        const propertyNames = ['age', 'first_name'];
        for (const [body, errorCode, message] of requests) {
          assert.throws(() => { extractEntity(body, propertyNames, existingEntity); }, (err) => {
            err.problemCode.should.equal(errorCode);
            err.message.should.match(message);
            return true;
          });
        }
      });
    });
  });

  describe('extractSelectedProperties', () => {
    const properties = [{ name: 'property1' }, { name: 'property2' }];

    it('returns null if query.$select is not present', () => {
      const query = {};
      const result = extractSelectedProperties(query, properties);
      should(result).be.null();
    });

    it('returns null if query.$select is equal to *', () => {
      const query = { $select: '*' };
      const result = extractSelectedProperties(query, properties);
      should(result).be.null();
    });

    it('throws error if a selected property is not a valid property', () => {
      const query = { $select: 'property1, property2, unknown_property' };
      (() => {
        extractSelectedProperties(query, properties);
      }).should.throw('Could not find a property named \'unknown_property\'');
    });

    it('throws error if an invalid system property is $selected', () => {
      const query = { $select: 'property1, property2, __system/unknown_property' };
      (() => {
        extractSelectedProperties(query, properties);
      }).should.throw('Could not find a property named \'__system/unknown_property\'');
    });

    it('returns set of selected properties if they are all valid', () => {
      const query = { $select: '__id, __system/createdAt, property1' };
      const result = extractSelectedProperties(query, properties);
      result.should.be.eql(new Set(['__id', '__system/createdAt', 'property1']));
    });

    it('returns all properties', () => {
      const query = { $select: '__id, __system, property1, property2' };
      const result = extractSelectedProperties(query, properties);
      result.should.be.eql(new Set(['__id', '__system', 'property1', 'property2']));
    });

  });

  describe('selectFields', () => {
    const entity = {
      uuid: 'uuid',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      deletedAt: 'deletedAt',
      conflict: 'hard',
      def: {
        label: 'label',
        version: 1,
        data: {
          firstName: 'John',
          lastName: 'Doe'
        }
      },
      aux: {
        creator: {
          id: 'id',
          displayName: 'displayName'
        }
      },
      updates: 0
    };
    const properties = [{ name: 'firstName' }, { name: 'lastName' }];

    it('selects all properties', () => {
      const selectedProperties = null;
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
        },
        firstName: entity.def.data.firstName,
        lastName: entity.def.data.lastName
      });
    });

    it('selects only specified properties', () => {
      const selectedProperties = new Set(['__id', 'label', 'firstName']);
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        firstName: entity.def.data.firstName
      });
    });

    it('selects only specified system properties', () => {
      const selectedProperties = new Set(['__id', 'label', '__system/createdAt']);
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt'
        }
      });
    });

    it('selects all system properties', () => {
      const selectedProperties = new Set(['__id', 'label', '__system']);
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
        }
      });
    });

    it('should return all properties even if entity object does not have all of them', () => {
      const data = {
        uuid: 'uuid',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        deletedAt: 'deletedAt',
        conflict: 'hard',
        def: {
          label: 'label',
          version: 1,
          data: {}
        },
        aux: {
          creator: {
            id: 'id',
            displayName: 'displayName'
          }
        },
        updates: 0
      };
      const selectedProperties = null;
      const result = selectFields(data, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
        },
        firstName: '',
        lastName: ''
      });
    });

    it('should sanitize property names', () => {
      entity.def.data['date.of.birth'] = '2023-01-01';
      properties.push({ name: 'date.of.birth' });
      const selectedProperties = null;
      const result = selectFields(entity, properties, selectedProperties);
      result.should.be.eql({
        __id: 'uuid',
        label: 'label',
        __system: {
          createdAt: 'createdAt',
          creatorId: 'id',
          creatorName: 'displayName',
          updatedAt: 'updatedAt',
          deletedAt: 'deletedAt',
          updates: 0,
          version: 1,
          conflict: 'hard'
        },
        firstName: entity.def.data.firstName,
        lastName: entity.def.data.lastName,
        date_of_birth: entity.def.data['date.of.birth']
      });
    });
  });

  describe('diffEntityData', () => {

    it('should return an array of empty arrays when given an array of identical entities', () => {
      const defs = [
        { name: 'John', age: '12' },
        { name: 'John', age: '12' },
        { name: 'John', age: '12' }
      ];

      const result = diffEntityData(defs);

      result.forEach(diff => diff.should.be.an.Array().and.be.empty());
    });

    it('should return an empty array when given an array with one or fewer elements', () => {
      const emptyDefs = [];
      const singleDef = [{ name: 'John', age: '12' }];

      const emptyResult = diffEntityData(emptyDefs);
      const singleResult = diffEntityData(singleDef);

      emptyResult.should.be.an.Array().and.be.empty();
      singleResult.should.be.an.Array().and.be.empty();
    });

    it('should return the diff', () => {
      const defs = [
        { name: 'John', age: '12' },
        { name: 'Jane', age: '12', city: 'Toronto' },
        { name: 'Robert', age: '12', city: 'Boston' },
        { name: 'Robert', age: '', city: '', sex: 'male' },
      ];

      const expectedOutput = [
        [
          { old: 'John', new: 'Jane', propertyName: 'name' },
          { old: undefined, new: 'Toronto', propertyName: 'city' }
        ],
        [
          { old: 'Jane', new: 'Robert', propertyName: 'name' },
          { old: 'Toronto', new: 'Boston', propertyName: 'city' }
        ],
        [
          { old: '12', new: '', propertyName: 'age' },
          { old: 'Boston', new: '', propertyName: 'city' },
          { old: undefined, new: 'male', propertyName: 'sex' }
        ]
      ];

      diffEntityData(defs).should.be.eql(expectedOutput);

    });
  });

  describe('getDiffProp', () => {

    it('should return list of different properties', () => {
      getDiffProp({ name: 'John', age: '22', hometown: 'Boston' }, { name: 'Jane', age: '22', hometown: 'Boston' })
        .should.eql(['name']);
    });

    it('should include properties not in 2nd argument', () => {
      getDiffProp({ name: 'John', age: '22', gender: 'male' }, { name: 'Jane', age: '22', hometown: 'Boston' })
        .should.eql(['name', 'gender']);
    });
  });

  describe('getWithConflictDetails', () => {

    it('should fill in correct information for SOFT conflict', () => {
      const defs = [
        new Entity.Def({ id: 0, version: 1, label: 'John', data: { name: 'John', age: '88' }, dataReceived: { name: 'John', age: '88' }, conflictingProp: null, baseVersion: null }),
        new Entity.Def({ id: 0, version: 2, label: 'Jane', data: { name: 'Jane', age: '88' }, dataReceived: { label: 'Jane', name: 'Jane' }, conflictingProp: [], baseVersion: 1 }),
        new Entity.Def({ id: 0, version: 3, label: 'Jane', data: { name: 'Jane', age: '99' }, dataReceived: { age: '99' }, conflictingProp: [], baseVersion: 1 })
      ];

      const audits = [{ action: 'entity.create', details: { entityDefId: 0 } }];

      const result = getWithConflictDetails(defs, audits, false);

      result[2].conflict.should.be.eql(ConflictType.SOFT);
      result[2].baseDiff.should.be.eql(['age']);
      result[2].serverDiff.should.be.eql(['age']);
    });

    it('should fill in correct information for HARD conflict', () => {
      const defs = [
        new Entity.Def({ id: 0, version: 1, label: 'John', data: { name: 'John', age: '88' }, dataReceived: { name: 'John', age: '88' }, conflictingProperties: null, baseVersion: null }),
        new Entity.Def({ id: 0, version: 2, label: 'Jane', data: { name: 'Jane', age: '77' }, dataReceived: { label: 'Jane', name: 'Jane', age: '77' }, conflictingProperties: [], baseVersion: 1 }),
        new Entity.Def({ id: 0, version: 3, label: 'Jane', data: { name: 'Jane', age: '99' }, dataReceived: { age: '99' }, conflictingProperties: ['age'], baseVersion: 1 })
      ];

      const audits = [{ action: 'entity.create', details: { entityDefId: 0 } }];

      const result = getWithConflictDetails(defs, audits, false);

      result[2].conflict.should.be.eql(ConflictType.HARD);
      result[2].baseDiff.should.be.eql(['age']);
      result[2].serverDiff.should.be.eql(['age']);
    });

    it('should return only relevant versions', () => {
      const defs = [
        new Entity.Def({ id: 0, version: 1, label: 'John', data: { name: 'John', age: '88' }, dataReceived: { name: 'John', age: '88' }, conflictingProp: null, baseVersion: null }),
        new Entity.Def({ id: 0, version: 2, label: 'Robert', data: { name: 'Robert', age: '20' }, dataReceived: { label: 'Robert', name: 'Robert', age: '20' }, conflictingProp: null, baseVersion: 1 }),
        new Entity.Def({ id: 0, version: 3, label: 'Jane', data: { name: 'Jane', age: '20' }, dataReceived: { label: 'Jane', name: 'Jane' }, conflictingProp: [], baseVersion: 2 }),
        new Entity.Def({ id: 0, version: 4, label: 'Jane', data: { name: 'Jane', age: '99' }, dataReceived: { age: '99' }, conflictingProp: [], baseVersion: 2 }),
        new Entity.Def({ id: 0, version: 5, label: 'Jane', data: { name: 'Jane', age: '10' }, dataReceived: { age: '10' }, conflictingProp: [], baseVersion: 3 }),
      ];

      const audits = [{ action: 'entity.create', details: { entityDefId: 0 } }];

      const result = getWithConflictDetails(defs, audits, true);

      result.map(v => v.version).should.eql([2, 3, 4, 5]);
    });
  });

  describe('extract bulk source from API request: extractBulkSource', () => {
    // Used to compare entity structure when Object.create(null) used.
    beforeEach(() => {
      should.config.checkProtoEql = false;
    });
    afterEach(() => {
      should.config.checkProtoEql = true;
    });

    it('should return source object', () => {
      const source = { name: 'myfile.csv', size: 300 };
      const count = 99;
      const userAgent = 'ua';
      extractBulkSource(source, count, userAgent).should.eql({ name: 'myfile.csv', size: 300, count: 99, userAgent: 'ua' });
    });

    it('should turn userAgent to null if empty string or null', () => {
      const source = { name: 'myfile.csv', size: 300 };
      const count = 99;

      should(extractBulkSource(source, count, '').userAgent).be.null();
      should(extractBulkSource(source, count, null).userAgent).be.null();
      extractBulkSource(source, count, ' ').userAgent.should.eql(' ');
    });

    it('should reject if source is null', () =>
      assert.throws(() => { extractBulkSource(null, 0, null); }, (err) => {
        err.problemCode.should.equal(400.2);
        err.message.should.equal('Required parameter source missing.');
        return true;
      }));

    it('should reject if source does not have a name field', () => {
      const source = { something: 'not name' };
      assert.throws(() => { extractBulkSource(source, 1, null); }, (err) => {
        err.problemCode.should.equal(400.2);
        err.message.should.equal('Required parameter source.name missing.');
        return true;
      });
    });

    it('should reject if source name is not a string', () => {
      const source = { name: 123 };
      assert.throws(() => { extractBulkSource(source, 1, null); }, (err) => {
        err.problemCode.should.equal(400.11);
        err.message.should.equal('Invalid input data type: expected (name) to be (string)');
        return true;
      });
    });

    it('should reject if source size is not a number', () => {
      const source = { name: 'myfile.csv', size: '123' };
      assert.throws(() => { extractBulkSource(source, 1, null); }, (err) => {
        err.problemCode.should.equal(400.11);
        err.message.should.equal('Invalid input data type: expected (size) to be (number)');
        return true;
      });
    });

    it('should allow size to be optional', () => {
      const source = { name: 'myfile.csv' };
      extractBulkSource(source, 1, 'ua').should.eql({ name: 'myfile.csv', count: 1, userAgent: 'ua' });
    });
  });
});
