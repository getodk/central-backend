const appRoot = require('app-root-path');
const { buildSubmission, convertObjectToXml, metaWithUuidXml } = require(appRoot + '/lib/data/odk-reporter');
const { Submission } = require(appRoot + '/lib/model/frames');

const formId = 'the-form-id';
const formVersion = '123';
const data = {
  system: {
    num_admins: { recent: 11, total: 22 }
  },
  projects: [
    {
      id: 123,
      users: { num_managers: { recent: 2, total: 2 } }
    },
    {
      id: 456,
      users: { num_managers: { recent: 3, total: 3 } }
    }
  ]
};

describe('odk reporter utility functions', () => {
  it('should convert metrics report object to submission xml', () => {
    const expected = '<system><num_admins><recent>11</recent><total>22</total></num_admins></system><projects><id>123</id><users><num_managers><recent>2</recent><total>2</total></num_managers></users></projects><projects><id>456</id><users><num_managers><recent>3</recent><total>3</total></num_managers></users></projects>';
    const xml = convertObjectToXml(data);
    xml.should.equal(expected);
  });

  it('should convert null values to empty string', () => {
    const xml = convertObjectToXml({ val: null });
    xml.should.equal('<val></val>');
  });

  it('should make a meta/uuid segment of xml', () => {
    const xml = metaWithUuidXml();
    xml.should.match(/<meta><instanceID>uuid:.*<\/instanceID><\/meta>/);
  });

  it('should build a valid xml submission that central can parse', () => {
    const xml = buildSubmission(formId, formVersion, data);

    return Submission.fromXml(xml).then((partial) => {
      partial.xmlFormId.should.equal('the-form-id');
      partial.instanceId.length.should.equal(41);
    });
  });

  it('should build xml when config/contact is empty', () => {
    const simpleData = { num_admins: 1, config: {} };
    const xml = buildSubmission(formId, formVersion, simpleData);
    xml.includes('<config></config>').should.equal(true);
  });

  it('should build xml when config is email only, no organization', () => {
    const config = { email: 'test@getodk.org' };
    const simpleData = { num_admins: 1, config };
    const xml = buildSubmission(formId, formVersion, simpleData, config);
    xml.includes('<config><email>test@getodk.org</email></config>').should.equal(true);
  });

  it('should build xml with full config info', () => {
    const config = { email: 'test@getodk.org', organization: 'ODK' };
    const simpleData = { num_admins: 1, config };
    const xml = buildSubmission(formId, formVersion, simpleData);
    xml.includes('<config><email>test@getodk.org</email><organization>ODK</organization></config>').should.equal(true);
  });
});

