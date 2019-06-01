const should = require('should');
const { Form } = require('../../../../lib/model/package').withDefaults();

describe('Form', () => {
  describe('fromXml', () => {
    /* gh #45 when we have a real xml validator we should re-enable this test:
    it('should reject invalid xml', (done) => {
      Form.fromXml('<a><b/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.1);
        done();
      });
    });*/

    it('should reject if the formId cannot be found (1: node nonexistent)', () =>
      Form.fromXml('<html/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
      }));

    it('should reject if the formId cannot be found (2: attr nonexistent)', () =>
      Form.fromXml('<html><head><model><instance><data><field/></data></instance></model></head></html>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
      }));

    it('should reject if the formId cannot be found (3: attr blank)', () =>
      Form.fromXml('<html><head><model><instance><data id=""><field/></data></instance></model></head></html>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
      }));

    it('should return a populated Form object if the xml passes', () => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance></model></head></html>';
      return Form.fromXml(xml).then((form) => {
        form.xform.xml.should.equal(xml);
        form.xmlFormId.should.equal('mycoolform');
      });
    });

    it('should pick up additional form metadata', () => {
      const xml = '<html><head><title>My Cool Form</title><model><instance><data id="mycoolform" version="1.0"><field/></data></instance></model></head></html>';
      return Form.fromXml(xml).then((form) => {
        form.name.should.equal('My Cool Form');
        form.xform.version.should.equal('1.0');
        form.xform.hash.should.equal('5ba55d383e978f07ee906fc62ff1b288');
        form.xform.sha.should.equal('89a2f70b74c690a128afce777a7c4b63d737e9be');
        form.xform.sha256.should.equal('103c7a532de07f6a429a55f90949bb010297562c3731feea1131b54b9088c221');
      });
    });

    it('should squash null version to empty-string', () => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance></model></head></html>';
      return Form.fromXml(xml).then((form) => {
        (form.xform.version === '').should.equal(true);
      });
    });
  });
});

