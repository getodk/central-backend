const should = require('should');
const { FormPartial, Key } = require('../../../../lib/model/package').withDefaults();

describe('Form', () => {
  describe('fromXml', () => {
    /* gh #45 when we have a real xml validator we should re-enable this test:
    it('should reject invalid xml', (done) => {
      FormPartial.fromXml('<a><b/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.1);
        done();
      });
    });*/

    it('should reject if the formId cannot be found (1: node nonexistent)', () =>
      FormPartial.fromXml('<html/>').should.be.rejected()
        .then((failure) => {
          failure.isProblem.should.equal(true);
          failure.problemCode.should.equal(400.2);
        }));

    it('should reject if the formId cannot be found (2: attr nonexistent)', () =>
      FormPartial.fromXml('<html><head><model><instance><data><field/></data></instance></model></head></html>')
        .should.be.rejected()
        .then((failure) => {
          failure.isProblem.should.equal(true);
          failure.problemCode.should.equal(400.2);
        }));

    it('should reject if the formId cannot be found (3: attr blank)', () =>
      FormPartial.fromXml('<html><head><model><instance><data id=""><field/></data></instance></model></head></html>')
        .should.be.rejected()
        .then((failure) => {
          failure.isProblem.should.equal(true);
          failure.problemCode.should.equal(400.2);
        }));

    it('should return a populated Form object if the xml passes', () => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance></model></head></html>';
      return FormPartial.fromXml(xml).then((partial) => {
        partial.xml.should.equal(xml);
        partial.xmlFormId.should.equal('mycoolform');
      });
    });

    it('should pick up additional form metadata', () => {
      const xml = '<html><head><title>My Cool Form</title><model><instance><data id="mycoolform" version="1.0"><field/></data></instance></model></head></html>';
      return FormPartial.fromXml(xml).then((partial) => {
        partial.name.should.equal('My Cool Form');
        partial.version.should.equal('1.0');
        partial.hash.should.equal('5ba55d383e978f07ee906fc62ff1b288');
        partial.sha.should.equal('89a2f70b74c690a128afce777a7c4b63d737e9be');
        partial.sha256.should.equal('103c7a532de07f6a429a55f90949bb010297562c3731feea1131b54b9088c221');
      });
    });

    it('should squash null version to empty-string', () => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance></model></head></html>';
      return FormPartial.fromXml(xml).then((partial) => {
        (partial.version === '').should.equal(true);
      });
    });

    it('should detect an encrypted form and extract its key', () => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance><submission base64RsaPublicKey="mypublickeygoeshere"/></model></head></html>';
      return FormPartial.fromXml(xml).then((partial) => {
        partial.key.isDefined().should.equal(true);
        partial.key.get().should.eql(new Key({ public: 'mypublickeygoeshere' }));
      });
    });

    it('should detect a not-encrypted form', () => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance><submission method="form-data-post" action="mywebsite.com"/></model></head></html>';
      return FormPartial.fromXml(xml).then((partial) => {
        partial.key.isDefined().should.equal(false);
      });
    });
  });
});

