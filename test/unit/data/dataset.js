const appRoot = require('app-root-path');
const should = require('should');
const { getFormFields } = require(appRoot + '/lib/data/schema');
const { getDatasets, matchFieldsWithDatasets, validateDatasetName, validatePropertyName } = require(appRoot + '/lib/data/dataset');
const testData = require(appRoot + '/test/data/xml');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');

describe('parsing dataset from entity block', () => {
  it('should run but find no dataset on non-entity forms', () =>
    getDatasets(testData.forms.simple).then((res) =>
      res.should.equal(Option.none())));

  describe('versioning', () => {
    it('should validate any version that starts with 2022.1.', () =>
      getDatasets(testData.forms.simpleEntity2022
        .replace('2022.1.0', '2022.1.123'))
        .should.be.fulfilled());

    it('should validate a version between major releases, e.g. 2023.2.0', () =>
      getDatasets(testData.forms.updateEntity2023
        .replace('2023.1.0', '2023.2.0'))
        .should.be.fulfilled());

    it('should validate any version that starts with 2023.1.', () =>
      getDatasets(testData.forms.updateEntity2023
        .replace('2023.1.0', '2023.1.123'))
        .should.be.fulfilled());

    it('should validate any version that starts with 2024.1.', () =>
      getDatasets(testData.forms.offlineEntity
        .replace('2024.1.0', '2024.1.123'))
        .should.be.fulfilled());

    it('should validate any version that starts with 2025.1.', () =>
      getDatasets(testData.forms.offlineEntity
        .replace('2024.1.0', '2025.1.123'))
        .should.be.fulfilled());

    it('should reject probable future version', () =>
      getDatasets(testData.forms.simpleEntity2022
        .replace('2022.1.0', '2026.1.0'))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version [2026.1.0] is not supported.' }));

    it('should complain if version is wrong', () =>
      getDatasets(testData.forms.simpleEntity2022
        .replace('entities-version="2022.1.0"', 'entities-version="bad-version"'))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version [bad-version] is not supported.' }));

    it('should complain if version is missing', () =>
      getDatasets(testData.forms.simpleEntity2022
        .replace('entities-version="2022.1.0"', ''))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version is missing.' }));
  });

  describe('extracting dataset name', () => {
    it('should retrieve the name of a dataset defined in entity block', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms/entities">
        <h:head>
          <model entities:entities-version="2022.1.0">
            <instance>
              <data id="FooForm">
                <name/>
                <age/>
                <meta>
                  <entities:entity dataset="foo" create="">
                    <entities:label/>
                  </entities:entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return getDatasets(xml).then((res) =>
        res.get().datasets[0].name.should.eql('foo'));
    });

    it('should retrieve the name of a dataset with namespace prefix on dataset attribute ', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms/entities">
        <h:head>
          <model entities:entities-version="2022.1.0">
            <instance>
              <data id="FooForm">
                <name/>
                <age/>
                <meta>
                  <entity entities:dataset="foo" create="">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return getDatasets(xml).then((res) =>
        res.get().datasets[0].name.should.eql('foo'));
    });

    it('should find dataset name even if other fields are in meta block before entity block', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms/entities">
          <h:head>
              <h:title>Foo Registration 2</h:title>
              <model entities:entities-version="2022.1.0">
                  <instance>
                      <data id="bar_registration" version="1234">
                          <bbb/>
                          <ccc/>
                          <meta>
                              <instanceID/>
                              <instanceName/>
                              <entity dataset="bar" create="">
                                <label/>
                              </entity>
                          </meta>
                      </data>
                  </instance>
                  <bind nodeset="/data/bbb" type="string" entities:save_to="b"/>
                </model>
          </h:head>
      </h:html>`;
      return getDatasets(xml).then((res) =>
        res.get().datasets[0].name.should.eql('bar'));
    });

    it('should return rejected promise if dataset name is missing', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms/entities">
        <h:head>
          <model entities:entities-version="2022.1.0">
            <instance>
              <data id="NoName">
                <name/>
                <age/>
                <meta>
                  <entity create="">
                    <label/>
                  <entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return getDatasets(xml).should.be.rejectedWith(Problem, {
        // Problem.user.invalidEntityForm
        problemCode: 400.25,
        message: 'The entity definition within the form is invalid. Dataset name is missing.'
      });
    });

    it('should return rejected promise if dataset name is invalid', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms/entities">
        <h:head>
          <model entities:entities-version="2022.1.0">
            <instance>
              <data id="badName">
                <name/>
                <age/>
                <meta>
                  <entity dataset="bad.name" create="">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return getDatasets(xml).should.be.rejectedWith(Problem, {
        // Problem.user.invalidEntityForm
        problemCode: 400.25,
        message: 'The entity definition within the form is invalid. Invalid dataset name.'
      });
    });

    it('should return rejected promise for <entities:entity> if dataset name is missing', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms/entities">
        <h:head>
          <model entities:entities-version="2022.1.0">
            <instance>
              <data id="NoName">
                <name/>
                <age/>
                <meta>
                  <entities:entity create="">
                    <label/>
                  </entities:entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return getDatasets(xml).should.be.rejectedWith(Problem, {
        problemCode: 400.25,
        message: 'The entity definition within the form is invalid. Dataset name is missing.'
      });
    });
  });

  describe('parsing entity actions', () => {
    it('should return create for a create form', async () => {
      const result = await getDatasets(testData.forms.simpleEntity);
      result.get().datasets[0].actions.should.eql(['create']);
    });

    it('should return update for an update form', async () => {
      const result = await getDatasets(testData.forms.updateEntity);
      result.get().datasets[0].actions.should.eql(['update']);
    });

    it('should return create and update for a form that can do both', async () => {
      const result = await getDatasets(testData.forms.updateEntity
        .replace('update=""', 'create="" update=""'));
      result.get().datasets[0].actions.should.eql(['create', 'update']);
    });

    it('should strip namespaces from action attributes', async () => {
      const result = await getDatasets(testData.forms.updateEntity
        .replace('update=""', 'entities:create="" entities:update=""'));
      result.get().datasets[0].actions.should.eql(['create', 'update']);
    });

    it('should reject for an entity form without an action', () => {
      const promise = getDatasets(testData.forms.simpleEntity
        .replace('create=""', ''));
      return promise.should.be.rejectedWith(Problem, {
        problemCode: 400.25,
        message: 'The entity definition within the form is invalid. The form must specify at least one entity action, for example, create or update.'
      });
    });
  });

  it('should extract entity properties from form field bindings', () =>
    getFormFields(testData.forms.simpleEntity).then((fields) => {
      // Check form field -> dataset property mappings
      fields[0].propertyName.should.equal('first_name');
      fields[0].path.should.equal('/name');

      fields[1].propertyName.should.equal('age');
      fields[1].path.should.equal('/age');

      fields[2].path.should.equal('/hometown');
      should.not.exist(fields[2].propertyName);
    }));

  it('should always parse entity field as type structure', async () => {
    const form = (entityBlock) => `<?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms/entities">
        <h:head>
          <model entities:entities-version="2023.1.0">
            <instance>
              <data id="brokenForm" orx:version="1.0">
                <age/>
                <meta>
                  ${entityBlock}
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

    // Entity block has no children
    const noChildEntity = '<entity dataset="people" id="" create="" update="" baseVersion=""/>';
    await getFormFields(form(noChildEntity)).then((fields) => {
      fields[2].name.should.equal('entity');
      fields[2].path.should.equal('/meta/entity');
      fields[2].type.should.equal('structure');
    });

    // Entity block has no children
    const emptyEntity = '<entity dataset="people" id="" create="" update="" baseVersion=""></entity>';
    await getFormFields(form(emptyEntity)).then((fields) => {
      fields[2].name.should.equal('entity');
      fields[2].path.should.equal('/meta/entity');
      fields[2].type.should.equal('structure');
    });

    // Entity block has whitespace
    const emptyEntityWhitespace = '<entity dataset="people" id="" create="" update="" baseVersion="">  </entity>';
    await getFormFields(form(emptyEntityWhitespace)).then((fields) => {
      fields[2].name.should.equal('entity');
      fields[2].path.should.equal('/meta/entity');
      fields[2].type.should.equal('structure');
    });

    // Entity block is not empty (most common case)
    const nonEmptyEntity = '<entity dataset="people" id="" create="" update="" baseVersion=""><label/></entity>';
    await getFormFields(form(nonEmptyEntity)).then((fields) => {
      fields[2].name.should.equal('entity');
      fields[2].path.should.equal('/meta/entity');
      fields[2].type.should.equal('structure');

      fields[3].name.should.equal('label');
      fields[3].path.should.equal('/meta/entity/label');
      fields[3].type.should.equal('unknown'); // label is unknown because there is no child and no bind
    });

    const nonEmptyLabel = '<entity dataset="people" id="" create="" update="" baseVersion=""><label>foo</label></entity>';
    await getFormFields(form(nonEmptyLabel)).then((fields) => {
      fields[2].name.should.equal('entity');
      fields[2].path.should.equal('/meta/entity');
      fields[2].type.should.equal('structure'); // is type structure because it contains a child

      fields[3].name.should.equal('label');
      fields[3].path.should.equal('/meta/entity/label');
      fields[3].type.should.equal('unknown'); // type unknown because no child node and no bind
    });
  });

  it('should always parse entity field as type structure even in group or repeat', async () => {
    const form = `<?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms/entities">
        <h:head>
          <model entities:entities-version="2025.1.0">
            <instance>
              <data id="brokenForm" orx:version="1.0">
                <tree>
                  <species/>
                  <circumference/>
                  <meta>
                      <entity dataset="trees" create="" id=""/>
                  </meta>
                </tree>
                <meta>
                  <instanceID/>
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

    const fields = await getFormFields(form);
    fields[4].name.should.equal('entity');
    fields[4].path.should.equal('/tree/meta/entity');
    fields[4].type.should.equal('structure');
  });
});

describe('dataset name validation', () => {
  it('should have name be case sensitive', () =>
    getDatasets(testData.forms.simpleEntity
      .replace('people', 'PeopleWithACapitalP')).then((res) =>
      res.get().datasets[0].name.should.eql('PeopleWithACapitalP')));

  it('should strip whitespace from name', () =>
    getDatasets(testData.forms.simpleEntity
      .replace('people', '   people ')).then((res) =>
      res.get().datasets[0].name.should.eql('people')));

  it('should reject empty name', () => {
    validateDatasetName('').should.equal(false);
  });

  it('should reject name that is all whitespace', () => {
    const name = '   ';
    validateDatasetName(name).should.equal(false);
    const xml = testData.forms.simpleEntity.replace('people', name);
    return getDatasets(xml).should.be.rejectedWith(Problem, {
      problemCode: 400.25,
      message: 'The entity definition within the form is invalid. Invalid dataset name.'
    });
  });

  it('should reject name with internal whitespace', () => {
    validateDatasetName('white space').should.equal(false);
  });

  it('should reject names with .', () => {
    validateDatasetName('this.that').should.equal(false);
  });

  it('should reject names starting with disallowed characters', () => {
    validateDatasetName('-nostartwithhyphen').should.equal(false);
  });

  it('should reject names starting with numbers', () => {
    validateDatasetName('123number').should.equal(false);
  });

  it('should allow names starting with certain characters', () => {
    validateDatasetName(':okstart').should.equal(true);
  });

  it('should allow names starting with certain characters', () => {
    validateDatasetName('_single_start_paren_ok').should.equal(true);
  });

  it('should reject name starting with reserved __ characters', () => {
    validateDatasetName('__system').should.equal(false);
  });

  it('should reject name with unicode', () => {
    validateDatasetName('unicode÷divide').should.equal(false);
  });

  it('should allow name with unicode letters', () => {
    validateDatasetName('bébés').should.equal(true);
  });

  it('should allow name with some other special characters', () => {
    validateDatasetName('people:children_above_10').should.equal(true);
  });

  it('should allow a valid name', () => {
    validateDatasetName('good_dataset_name').should.equal(true);
  });
});

describe('property name validation', () => {
  // ALLOW
  it('should allow name with underscore', () => {
    validatePropertyName('first_name').should.equal(true);
  });

  it('should allow name with period', () => {
    validatePropertyName('first.name').should.equal(true);
  });

  it('should allow name with hyphen', () => {
    validatePropertyName('first-name').should.equal(true);
  });

  it('should allow name starting with single underscore', () => {
    validatePropertyName('_age').should.equal(true);
  });

  it('should allow name containing "name" but not exactly matching', () => {
    validatePropertyName('name.of.child').should.equal(true);
  });

  it('should allow name containing "label" but not exactly matching', () => {
    validatePropertyName('final_label').should.equal(true);
  });

  it('should allow name with unicode letters', () => {
    validatePropertyName('bébés').should.equal(true);
  });

  // REJECT
  it('should reject property named "name"', () => {
    validatePropertyName('name').should.equal(false);
  });

  it('should reject property named "label"', () => {
    validatePropertyName('label').should.equal(false);
  });

  it('should reject name or label in case-insensitive way', () => {
    validatePropertyName('Name').should.equal(false);
    validatePropertyName('NaMe').should.equal(false);
    validatePropertyName('LABEL').should.equal(false);
  });

  it('should reject name with whitespace at the ends', () => {
    validatePropertyName(' bad_whitespace ').should.equal(false);
  });

  it('should reject name with spaces in the middle', () => {
    validatePropertyName('first name').should.equal(false);
  });

  it('should reject property with slash', () => {
    validatePropertyName('bad\name').should.equal(false);
  });

  it('should reject names starting number', () => {
    validatePropertyName('123bad').should.equal(false);
  });

  it('should reject names starting with double underscore __', () => {
    validatePropertyName('__bad').should.equal(false);
  });

  it('should reject names starting with other disallowed characters like -', () => {
    validatePropertyName('-bad').should.equal(false);
  });

  it('should reject names starting with other disallowed characters like .', () => {
    validatePropertyName('.bad').should.equal(false);
  });

  it('should reject names starting with : colon', () => {
    validatePropertyName(':badprop').should.equal(false);
  });

  it('should reject names containing a : colon', () => {
    validatePropertyName('bad:prop').should.equal(false);
  });

  it('should reject name with unicode', () => {
    validatePropertyName('unicode÷divide').should.equal(false);
  });
});

describe('entities from repeats', () => {
  describe('parsing multiple entities/datasets from a form def', () => {
    it('should retrieve the names of datasets at root and in repeat group', async () => {
      const ds = await getDatasets(testData.forms.repeatEntityHousehold).then(o => o.get());
      should.not.exist(ds.warnings);
      ds.datasets.should.eql([
        { name: 'people', actions: [ 'create' ], path: '/members/person/' },
        { name: 'households', actions: [ 'create' ], path: '/' }
      ]);
    });

    it('should retrieve the names of datasets at different levels', async () => {
      const ds = await getDatasets(testData.forms.multiEntityFarm).then(o => o.get());
      should.not.exist(ds.warnings);
      ds.datasets.should.eql([
        { name: 'farmers', actions: [ 'create' ], path: '/farm/farmer/' },
        { name: 'farms', actions: [ 'create' ], path: '/farm/' }
      ]);
    });

    it('should retrieve the names of a dataset in a repeat group', async () => {
      const ds = await getDatasets(testData.forms.repeatEntityTrees).then(o => o.get());
      should.not.exist(ds.warnings);
      // Includes dataset from jr:template block and regular block
      ds.datasets.length.should.equal(2);
      ds.datasets.should.eql([
        { name: 'trees', actions: [ 'create', 'update' ], path: '/tree/' },
        { name: 'trees', actions: [ 'create', 'update' ], path: '/tree/' }
      ]);

      const ff = await getFormFields(testData.forms.repeatEntityTrees);
      const res = matchFieldsWithDatasets(ds.datasets, ff);

      // After matchFieldsWithDataset, duplicate dataset is removed
      res.length.should.equal(1);
      res[0].dataset.should.eql(
        { name: 'trees', actions: [ 'create', 'update' ], path: '/tree/', isRepeat: true }
      );
    });
  });

  describe('matching form fields with datasets', () => {
    it('should match fields with dataset inside a repeat', async () => {
      const ds = await getDatasets(testData.forms.repeatEntityTrees);
      const ff = await getFormFields(testData.forms.repeatEntityTrees);
      const res = matchFieldsWithDatasets(ds.get().datasets, ff);
      res.length.should.equal(1);
      res[0].dataset.should.eql({
        name: 'trees',
        actions: ['create', 'update'],
        path: '/tree/',
        isRepeat: true
      });
      res[0].fields.should.eql([
        {
          name: 'species',
          order: 2,
          path: '/tree/species',
          propertyName: 'species',
          type: 'string'
        },
        {
          name: 'circumference',
          order: 3,
          path: '/tree/circumference',
          propertyName: 'circumference',
          type: 'int'
        }
      ]);
    });

    it('should match fields with datasets with one in a repeat', async () => {
      const ds = await getDatasets(testData.forms.repeatEntityHousehold);
      const ff = await getFormFields(testData.forms.repeatEntityHousehold);
      const res = matchFieldsWithDatasets(ds.get().datasets, ff);
      res.length.should.equal(2);

      res[0].dataset.should.eql({
        name: 'people',
        actions: ['create'],
        path: '/members/person/',
        isRepeat: true
      });

      res[0].fields.should.eql([
        {
          name: 'name',
          order: 4,
          path: '/members/person/name',
          propertyName: 'full_name',
          type: 'string'
        },
        {
          name: 'age',
          order: 5,
          path: '/members/person/age',
          propertyName: 'age',
          type: 'int'
        }
      ]);

      res[1].dataset.should.eql({
        name: 'households',
        actions: ['create'],
        path: '/'
      });
      res[1].fields.should.eql([
        {
          name: 'household_id',
          order: 0,
          path: '/household_id',
          propertyName: 'hh_id',
          type: 'string'
        },
        {
          name: 'num_people',
          order: 2,
          path: '/members/num_people',
          propertyName: 'count',
          type: 'int'
        }
      ]);
    });

    it('should match fields with datasets at different levels', async () => {
      const ds = await getDatasets(testData.forms.multiEntityFarm);
      const ff = await getFormFields(testData.forms.multiEntityFarm);
      const res = matchFieldsWithDatasets(ds.get().datasets, ff);
      res.length.should.equal(2);

      res[0].dataset.should.eql({
        name: 'farmers',
        actions: ['create'],
        path: '/farm/farmer/'
      });
      res[0].fields.should.eql([
        {
          name: 'farmer_name',
          order: 5,
          path: '/farm/farmer/farmer_name',
          propertyName: 'full_name',
          type: 'string'
        },
        {
          name: 'age',
          order: 6,
          path: '/farm/farmer/age',
          propertyName: 'age',
          type: 'int'
        }
      ]);

      res[1].dataset.should.eql({
        name: 'farms',
        actions: ['create'],
        path: '/farm/'
      });
      res[1].fields.should.eql([
        {
          name: 'farm_id',
          order: 1,
          path: '/farm/farm_id',
          propertyName: 'farm_id',
          type: 'string'
        },
        {
          name: 'location',
          order: 2,
          path: '/farm/location',
          propertyName: 'geometry',
          type: 'geopoint'
        },
        {
          name: 'acres',
          path: '/farm/acres',
          order: 3,
          type: 'int',
          propertyName: 'acres'
        }
      ]);
    });

    it('should ignore binds / fields with properties that are outside the context of the entity', async() => {
      // Same as repeatEntityTrees but adding a bind to plot_id which is outside of the repeat group
      const form = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms">
    <h:head>
        <h:title>Repeat Trees</h:title>
        <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
            <instance>
                <data id="repeatEntityTrees" version="1">
                    <plot_id/>
                    <tree>
                        <species/>
                        <circumference/>
                        <meta>
                            <entity dataset="trees" create="" id="">
                                <label/>
                            </entity>
                        </meta>
                    </tree>
                    <meta>
                        <instanceID/>
                    </meta>
                </data>
            </instance>
            <bind nodeset="/data/plot_id" type="string" entities:saveto="plot_id"/>
            <bind nodeset="/data/tree/species" type="string" entities:saveto="species"/>
            <bind nodeset="/data/tree/circumference" type="int" entities:saveto="circumference"/>
            <bind nodeset="/data/tree/meta/entity/@id" type="string"/>
            <setvalue event="odk-instance-first-load odk-new-repeat" ref="/data/tree/meta/entity/@id" value="uuid()"/>
            <bind nodeset="/data/tree/meta/entity/label" calculate="../../../species" type="string"/>
            <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
        </model>
    </h:head>
    <h:body>
        <input ref="/data/plot_id">
            <label>Enter the ID of the plot</label>
        </input>
        <group ref="/data/tree">
            <label>Enter info about each tree</label>
            <repeat nodeset="/data/tree">
                <input ref="/data/tree/species">
                    <label>Tree Species</label>
                </input>
                <input ref="/data/tree/circumference">
                    <label>Tree Circumference</label>
                </input>
            </repeat>
        </group>
    </h:body>
</h:html>`;

      const ds = await getDatasets(form);
      const ff = await getFormFields(form);
      const res = matchFieldsWithDatasets(ds.get().datasets, ff);

      // there should be no field named plot_id because it is outside the scope of the entity
      should.not.exist(res[0].fields.find(f => f.name === 'plot_id'));
    });

    it('should not mix up datasets when names are containment matches like farm and farmer', async() => {
      const form = `
      <?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
    <h:head>
        <h:title>Farms and Farmers - Multi Level Entities</h:title>
        <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
            <instance>
                <data id="multiEntityFarm" version="2">
                    <farm>
                        <farm_id/>
                        <location/>
                        <acres/>
                        <meta>
                            <entity dataset="farm" id="" create="1">
                                <label/>
                            </entity>
                        </meta>
                    </farm>
                    <farmer>
                        <farmer_name/>
                        <age/>
                        <meta>
                            <entity dataset="farmer" create="" id="">
                                <label/>
                            </entity>
                        </meta>
                    </farmer>
                    <meta>
                        <instanceID/>
                        <instanceName/>
                    </meta>
                </data>
            </instance>
            <bind nodeset="/data/farm/farm_id" type="string" entities:saveto="farm_id"/>
            <bind nodeset="/data/farm/location" type="geopoint" entities:saveto="geometry"/>
            <bind nodeset="/data/farm/acres" type="int" entities:saveto="acres"/>
            <bind nodeset="/data/farmer/farmer_name" type="string" entities:saveto="full_name"/>
            <bind nodeset="/data/farmer/age" type="int" entities:saveto="age"/>
            <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
            <bind nodeset="/data/meta/instanceName" type="string" calculate="concat(&quot;Farm &quot;,  /data/farm/farm_id , &quot;-&quot;,  /data/farmer/farmer_name )"/>
            <bind nodeset="/data/farm/meta/entity/@id" type="string" readonly="true()"/>
            <setvalue ref="/data/farm/meta/entity/@id" event="odk-instance-first-load" type="string" readonly="true()" value="uuid()"/>
            <bind nodeset="/data/farm/meta/entity/label" calculate="concat(&quot;Farm &quot;,  /data/farm/farm_id )" type="string" readonly="true()"/>
            <bind nodeset="/data/farmer/meta/entity/@id" type="string" readonly="true()"/>
            <setvalue ref="/data/farmer/meta/entity/@id" event="odk-instance-first-load" type="string" readonly="true()" value="uuid()"/>
            <bind nodeset="/data/farmer/meta/entity/label" calculate="concat(&quot;Farmer &quot;,  /data/farmer/farmer_name )" type="string" readonly="true()"/>
        </model>
    </h:head>
</h:html>`;

      const ds = await getDatasets(form);
      const ff = await getFormFields(form);
      const res = matchFieldsWithDatasets(ds.get().datasets, ff);
      res[0].dataset.name.should.equal('farm');
      res[0].fields.length.should.eql(3);
      res[0].testFields.length.should.eql(6);
      res[1].dataset.name.should.equal('farmer');
      res[1].fields.length.should.eql(2);
      res[1].testFields.length.should.eql(5);
    });

    it('should allow entity scope to be a group within a repeat and not the repeat itself', async() => {
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

      const ds = await getDatasets(form);
      const ff = await getFormFields(form);
      const res = matchFieldsWithDatasets(ds.get().datasets, ff);

      res.length.should.equal(1);
      res[0].dataset.name.should.equal('trees');
      res[0].dataset.path.should.equal('/outer_repeat/outer_group/inner_repeat/inner_group/');
      res[0].fields.length.should.eql(1);
      res[0].testFields.length.should.eql(4);
    });
  });
});
