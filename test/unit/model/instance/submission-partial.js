const should = require('should');
const Option = require('../../../../lib/util/option');
const { SubmissionPartial } = require('../../../../lib/model/package').withDefaults();

describe('SubmissionPartial', () => {
  describe('fromXml', () => {
    /* gh #45 when we have a real xml validator we should re-enable this test:
    it('should reject invalid xml', () =>
      SubmissionPartial.fromXml('<a><b/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.1);
      }));*/

    it('should reject if the formId does not exist (1: no attribute)', () =>
      SubmissionPartial.fromXml('<data><field/></data>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
      }));

    it('should reject if the formId does not exist (2: blank)', () =>
      SubmissionPartial.fromXml('<data id=""><field/></data>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
      }));

    it('should find instanceID in meta', () =>
      SubmissionPartial.fromXml('<data id="mycoolform"><orx:meta><orx:instanceID>idtest</orx:instanceID></orx:meta><field/></data>').then((partial) => {
        partial.instanceId.should.equal('idtest');
      }));

    it('should find instanceID directly in data envelope', () =>
      SubmissionPartial.fromXml('<data id="mycoolform"><instanceID>idtest</instanceID><field/></data>').then((partial) => {
        partial.instanceId.should.equal('idtest');
      }));

    it('should generate an instance id if not found', () =>
      SubmissionPartial.fromXml('<data id="mycoolform"><field/></data>').then((partial) => {
        partial.instanceId.should.be.a.uuid();
      }));

    it('should return a populated SubmissionPartial given correct xml', () => {
      const xml = '<data id="mycoolform" version="coolest"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      return SubmissionPartial.fromXml(xml).then((partial) => {
        partial.xmlFormId.should.equal('mycoolform');
        partial.instanceId.should.equal('myinstance');
        partial.version.should.equal('coolest');
        partial.xml.should.equal(xml);
      });
    });

    it('should squash null version to empty-string', () => {
      const xml = '<data id="mycoolform"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      return SubmissionPartial.fromXml(xml).then((partial) => {
        (partial.version === '').should.equal(true);
      });
    });

    it('should work given an xml preamble', () => {
      const xml = '<?xml version="1.0"?><data id="mycoolform"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      return SubmissionPartial.fromXml(xml).then((partial) => {
        partial.xmlFormId.should.equal('mycoolform');
        partial.instanceId.should.equal('myinstance');
        partial.xml.should.equal(xml);
      });
    });
  });
});

