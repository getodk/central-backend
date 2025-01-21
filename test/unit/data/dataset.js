const appRoot = require('app-root-path');
const should = require('should');
const { getFormFields } = require(appRoot + '/lib/data/schema');
const { getDataset, validateDatasetName, validatePropertyName } = require(appRoot + '/lib/data/dataset');
const testData = require(appRoot + '/test/data/xml');
const Problem = require(appRoot + '/lib/util/problem');
const Option = require(appRoot + '/lib/util/option');

describe('parsing dataset from entity block', () => {
  it('should run but find no dataset on non-entity forms', () =>
    getDataset(testData.forms.simple).then((res) =>
      res.should.equal(Option.none())));

  describe('versioning', () => {
    it('should validate any version that starts with 2022.1.', () =>
      getDataset(testData.forms.simpleEntity2022
        .replace('2022.1.0', '2022.1.123'))
        .should.be.fulfilled());

    it('should validate a version between major releases, e.g. 2023.2.0', () =>
      getDataset(testData.forms.updateEntity2023
        .replace('2023.1.0', '2023.2.0'))
        .should.be.fulfilled());

    it('should validate any version that starts with 2023.1.', () =>
      getDataset(testData.forms.updateEntity2023
        .replace('2023.1.0', '2023.1.123'))
        .should.be.fulfilled());

    it('should validate any version that starts with 2024.1.', () =>
      getDataset(testData.forms.offlineEntity
        .replace('2024.1.0', '2024.1.123'))
        .should.be.fulfilled());

    it('should reject probable future version', () =>
      getDataset(testData.forms.simpleEntity2022
        .replace('2022.1.0', '2025.1.0'))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version [2025.1.0] is not supported.' }));

    it('should complain if version is wrong', () =>
      getDataset(testData.forms.simpleEntity2022
        .replace('entities-version="2022.1.0"', 'entities-version="bad-version"'))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version [bad-version] is not supported.' }));

    it('should complain if version is missing', () =>
      getDataset(testData.forms.simpleEntity2022
        .replace('entities-version="2022.1.0"', ''))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version is missing.' }));
  });

  describe('extracting dataset name', () => {
    it('should retrieve the name of a dataset defined in entity block', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
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
      return getDataset(xml).then((res) =>
        res.get().name.should.eql('foo'));
    });

    it('should retrieve the name of a dataset with namespace prefix on dataset attribute ', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
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
      return getDataset(xml).then((res) =>
        res.get().name.should.eql('foo'));
    });

    it('should find dataset name even if other fields are in meta block before entity block', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
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
      return getDataset(xml).then((res) =>
        res.get().name.should.eql('bar'));
    });

    it('should return rejected promise if dataset name is missing', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
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
      return getDataset(xml).should.be.rejectedWith(Problem, {
        // Problem.user.invalidEntityForm
        problemCode: 400.25,
        message: 'The entity definition within the form is invalid. Dataset name is missing.'
      });
    });

    it('should return rejected promise if dataset name is invalid', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
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
      return getDataset(xml).should.be.rejectedWith(Problem, {
        // Problem.user.invalidEntityForm
        problemCode: 400.25,
        message: 'The entity definition within the form is invalid. Invalid dataset name.'
      });
    });

    it('should return rejected promise for <entities:entity> if dataset name is missing', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
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
      return getDataset(xml).should.be.rejectedWith(Problem, {
        problemCode: 400.25,
        message: 'The entity definition within the form is invalid. Dataset name is missing.'
      });
    });
  });

  describe('parsing entity actions', () => {
    it('should return create for a create form', async () => {
      const result = await getDataset(testData.forms.simpleEntity);
      result.get().actions.should.eql(['create']);
    });

    it('should return update for an update form', async () => {
      const result = await getDataset(testData.forms.updateEntity);
      result.get().actions.should.eql(['update']);
    });

    it('should return create and update for a form that can do both', async () => {
      const result = await getDataset(testData.forms.updateEntity
        .replace('update=""', 'create="" update=""'));
      result.get().actions.should.eql(['create', 'update']);
    });

    it('should strip namespaces from action attributes', async () => {
      const result = await getDataset(testData.forms.updateEntity
        .replace('update=""', 'entities:create="" entities:update=""'));
      result.get().actions.should.eql(['create', 'update']);
    });

    it('should reject for an entity form without an action', () => {
      const promise = getDataset(testData.forms.simpleEntity
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

  it('should alawys parse entity field as type structure', async () => {
    const form = (entityBlock) => `<?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
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
});

describe('dataset name validation', () => {
  it('should have name be case sensitive', () =>
    getDataset(testData.forms.simpleEntity
      .replace('people', 'PeopleWithACapitalP')).then((res) =>
      res.get().name.should.eql('PeopleWithACapitalP')));

  it('should strip whitespace from name', () =>
    getDataset(testData.forms.simpleEntity
      .replace('people', '   people ')).then((res) =>
      res.get().name.should.eql('people')));

  it('should reject empty name', () => {
    validateDatasetName('').should.equal(false);
  });

  it('should reject name that is all whitespace', () => {
    const name = '   ';
    validateDatasetName(name).should.equal(false);
    const xml = testData.forms.simpleEntity.replace('people', name);
    return getDataset(xml).should.be.rejectedWith(Problem, {
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
