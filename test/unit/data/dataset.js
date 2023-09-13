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
    it('should check for any version that starts with 2022.1.', () =>
      getDataset(testData.forms.simpleEntity
        .replace('2022.1.0', '2022.1.123')).then((res) =>
        res.get().should.eql('people')));

    it('should reject probable future version', () =>
      getDataset(testData.forms.simpleEntity
        .replace('2022.1.0', '2023.1.0'))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version [2023.1.0] is not supported.' }));

    it('should complain if version is wrong', () =>
      getDataset(testData.forms.simpleEntity
        .replace('entities-version="2022.1.0"', 'entities-version="bad-version"'))
        .should.be.rejectedWith(Problem, { problemCode: 400.25,
          message: 'The entity definition within the form is invalid. Entities specification version [bad-version] is not supported.' }));

    it('should complain if version is missing', () =>
      getDataset(testData.forms.simpleEntity
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
                  <entities:entity dataset="foo">
                    <entities:label/>
                  </entities:entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return getDataset(xml).then((res) =>
        res.get().should.eql('foo'));
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
                  <entity entities:dataset="foo">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      return getDataset(xml).then((res) =>
        res.get().should.eql('foo'));
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
                              <entity dataset="bar">
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
        res.get().should.eql('bar'));
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
                  <entity>
                    <label/>
                  <entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      // Problem.user.invalidEntityForm
      return getDataset(xml).should.be.rejectedWith(Problem, { problemCode: 400.25 });
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
                  <entity dataset="bad.name">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      // Problem.user.invalidEntityForm
      return getDataset(xml).should.be.rejectedWith(Problem, { problemCode: 400.25 });
    });
  });

  it('should tolerate this weird edge case', () => {
    // This is a weird case where the code looking for the <entity> block at all
    // fails to find it. But since it also contains no dataset name, it treats
    // this form as a valid non-entity-related form.
    const xml = `
    <?xml version="1.0"?>
    <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
            <h:title>Foo Registration 2</h:title>
            <model odk:xforms-version="1.0.0">
                <instance>
                    <data id="bar_registration" version="1234">
                        <bbb/>
                        <ccc/>
                        <meta>
                            <instanceID/>
                            <instanceName/>
                            <entities:entity>
                              <entities:label/>
                            </entities:entity>
                        </meta>
                    </data>
                </instance>
                <bind nodeset="/data/bbb" type="string" entities:save_to="b"/>
              </model>
        </h:head>
    </h:html>`;
    return getDataset(xml).then((res) =>
      res.should.equal(Option.none()));
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
});

describe('dataset name validation', () => {
  it('should have name be case sensitive', () =>
    getDataset(testData.forms.simpleEntity
      .replace('people', 'PeopleWithACapitalP')).then((res) =>
      res.get().should.eql('PeopleWithACapitalP')));

  it('should strip whitespace from name', () =>
    getDataset(testData.forms.simpleEntity
      .replace('people', '   people ')).then((res) =>
      res.get().should.eql('people')));

  it('should reject names with .', () => {
    validateDatasetName('this.that').should.equal(false);
  });

  it('should reject empty name', () => {
    validateDatasetName('').should.equal(false);
  });

  it('should reject blank string name', () => {
    validateDatasetName('   ').should.equal(false);
  });

  it('should reject name with whitepsace', () => {
    validateDatasetName('white space').should.equal(false);
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
    validateDatasetName('bébés').should.equal(true);
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
    validateDatasetName('unicode÷divide').should.equal(false);
  });
});
