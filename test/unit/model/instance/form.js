const should = require('should');
const { Form } = require('../../../../lib/model/package').withDefaults();

describe('Form', () => {
  describe('fromXml', () => {
    it('should reject invalid xml', (done) => {
      Form.fromXml('<a><b/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.1);
        done();
      });
    });

    it('should reject if the formId cannot be found (1: node nonexistent)', (done) => {
      Form.fromXml('<html/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        done();
      });
    });

    it('should reject if the formId cannot be found (2: attr nonexistent)', (done) => {
      Form.fromXml('<html><head><model><instance><data><field/></data></instance></model></head></html>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        done();
      });
    });

    it('should reject if the formId cannot be found (3: attr blank)', (done) => {
      Form.fromXml('<html><head><model><instance><data id=""><field/></data></instance></model></head></html>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        done();
      });
    });

    it('should return a populated Form object if the xml passes', (done) => {
      const xml = '<html><head><model><instance><data id="mycoolform"><field/></data></instance></model></head></html>';
      Form.fromXml(xml).then((form) => {
        form.xml.should.equal(xml);
        form.xmlFormId.should.equal('mycoolform');
        done();
      }).point();
    });
  });
});

