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

    it('should reject if the formId cannot be found (1: node nonexistent)', (done) => {
      Form.fromXml('<html/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        done();
      }).point();
    });

    it('should reject if the formId cannot be found (2: attr nonexistent)', (done) => {
      Form.fromXml('<html><head><model><instance><data><field/></data></instance></model></head></html>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        done();
      }).point();
    });

    it('should reject if the formId cannot be found (3: attr blank)', (done) => {
      Form.fromXml('<html><head><model><instance><data id=""><field/></data></instance></model></head></html>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        done();
      }).point();
    });

    it('should return a populated Form object if the xml passes', (done) => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance></model></head></html>';
      Form.fromXml(xml).then((form) => {
        form.xml.should.equal(xml);
        form.xmlFormId.should.equal('mycoolform');
        done();
      }).point();
    });

    it('should pick up additional form metadata', () => {
      const xml = '<html><head><title>My Cool Form</title><model><instance><data id="mycoolform" version="1.0"><field/></data></instance></model></head></html>';
      return Form.fromXml(xml).then((form) => {
        console.log(form);
        form.name.should.equal('My Cool Form');
        form.version.should.equal('1.0');
        form.hash.should.equal('5ba55d383e978f07ee906fc62ff1b288');
      }).point();
    });

    it('should squash null version to empty-string', (done) => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance></model></head></html>';
      Form.fromXml(xml).then((form) => {
        (form.version === '').should.equal(true);
        done();
      }).point();
    });
  });
});

