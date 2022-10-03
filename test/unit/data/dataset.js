const appRoot = require('app-root-path');
const should = require('should');
// eslint-disable-next-line import/no-dynamic-require
const { getFormFields } = require(appRoot + '/lib/data/schema');
// eslint-disable-next-line import/no-dynamic-require
const { getDataset, validateDatasetName } = require(appRoot + '/lib/data/dataset');
// eslint-disable-next-line import/no-dynamic-require
const testData = require(appRoot + '/test/data/xml');
// eslint-disable-next-line import/no-dynamic-require
const Problem = require(appRoot + '/lib/util/problem');
// eslint-disable-next-line import/no-dynamic-require
const Option = require(appRoot + '/lib/util/option');

describe('parsing dataset from entity block', () => {
  it('should run but find no dataset on non-entity forms', () =>
    getDataset(testData.forms.simple).then((res) =>
      res.should.equal(Option.none())));

  describe('extracting dataset name', () => {
    it('should retrieve the name of a dataset defined in entity block', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model>
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

    it('should retrieve the name of a dataset with superfluous prefix on dataset attribute ', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model>
            <instance>
              <data id="FooForm">
                <name/>
                <age/>
                <meta>
                  <entities:entity entities:dataset="foo">
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

    it('should find dataset name even if other fields are in meta block before entity block', () => {
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
                              <entities:entity dataset="bar">
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
        res.get().should.eql('bar'));
    });

    it('should return rejected promise if dataset name is missing', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model>
            <instance>
              <data id="NoName">
                <name/>
                <age/>
                <meta>
                  <entities:entity>
                    <entities:label/>
                  </entities:entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      // Problem.user.invalidEntityForm
      return getDataset(xml).should.be.rejectedWith(Problem, { problemCode: 400.23 });
    });

    it('should return rejected promise if dataset name is missing', () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model>
            <instance>
              <data id="badName">
                <name/>
                <age/>
                <meta>
                  <entities:entity dataset="bad.name">
                    <entities:label/>
                  </entities:entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
      // Problem.user.invalidEntityForm
      return getDataset(xml).should.be.rejectedWith(Problem, { problemCode: 400.23 });
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
  it('should reject names with .', () => {
    validateDatasetName('this.that').should.equal(false);
  });

  it('should reject empty name', () => {
    validateDatasetName('').should.equal(false);
  });

  it('should reject blank string name', () => {
    validateDatasetName('   ').should.equal(false);
  });

  it('should reject name starting with reserved __ characters', () => {
    validateDatasetName('__system').should.equal(false);
  });

  it('should allow a valid name', () => {
    validateDatasetName('good_dataset_name').should.equal(true);
  });
});
