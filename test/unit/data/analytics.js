const appRoot = require('app-root-path');
const should = require('should');
const { buildSubmission, convertObjectToXml, metaWithUuidXml, metricsTemplate } = require(appRoot + '/lib/data/analytics');
const { Submission } = require(appRoot + '/lib/model/frames');

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

describe('analytics data', () => {
  it('should convert metrics report object to submission xml', () => {
    const expected = "<system><num_admins><recent>11</recent><total>22</total></num_admins></system><projects><id>123</id><users><num_managers><recent>2</recent><total>2</total></num_managers></users></projects><projects><id>456</id><users><num_managers><recent>3</recent><total>3</total></num_managers></users></projects>";
    const xml = convertObjectToXml(data);
    xml.should.equal(expected);
  });

  it('should make a meta/uuid segment of xml', () => {
    const xml = metaWithUuidXml().replace(/<instanceID>(.*)<\/instanceID>/, '<instanceID>1234</instanceID>');
    xml.should.equal('<meta><instanceID>1234</instanceID></meta>');
  });

  it('should build a valid xml submission that central can parse', () => {
    const formId = 'the-form-id';
    const formVersion = '123';
    const config = { email: 'test@getodk.org', organization: 'ODK' };
    const xml = buildSubmission(formId, formVersion, data, config);
    const expected = '<?xml version="1.0"?><data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="the-form-id" version="123"><system><num_admins><recent>11</recent><total>22</total></num_admins></system><projects><id>123</id><users><num_managers><recent>2</recent><total>2</total></num_managers></users></projects><projects><id>456</id><users><num_managers><recent>3</recent><total>3</total></num_managers></users></projects><config><email>test@getodk.org</email><organization>ODK</organization></config><meta><instanceID>1234</instanceID></meta></data>';

    return Submission.fromXml(xml).then((partial) => {
      partial.xmlFormId.should.equal('the-form-id');
      partial.instanceId.length.should.equal(41);
      partial.xml.replace(/<instanceID>(.*)<\/instanceID>/, '<instanceID>1234</instanceID>').should.equal(expected);
    });
  });

  it('should build xml when config/contact is empty', () => {
    const formId = 'the-form-id';
    const formVersion = '123';
    const config = {};
    const simpleData = { num_admins: 1 };
    const xml = buildSubmission(formId, formVersion, simpleData, config).replace(/<instanceID>(.*)<\/instanceID>/, '<instanceID>1234</instanceID>');
    xml.should.equal('<?xml version="1.0"?><data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="the-form-id" version="123"><num_admins>1</num_admins><config></config><meta><instanceID>1234</instanceID></meta></data>');
  });

  it('should build xml when config is email only, no organization', () => {
    const formId = 'the-form-id';
    const formVersion = '123';
    const config = { email: 'test@getodk.org' };
    const simpleData = { num_admins: 1 };
    const xml = buildSubmission(formId, formVersion, simpleData, config).replace(/<instanceID>(.*)<\/instanceID>/, '<instanceID>1234</instanceID>');
    xml.should.equal('<?xml version="1.0"?><data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="the-form-id" version="123"><num_admins>1</num_admins><config><email>test@getodk.org</email></config><meta><instanceID>1234</instanceID></meta></data>');
  });
});

