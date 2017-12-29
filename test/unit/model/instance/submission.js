const should = require('should');
const Option = require('../../../../lib/reused/option');
const { Submission } = require('../../../../lib/model/package').withDefaults();

describe('Submission', () => {
  describe('fromXml', () => {
    it('should reject invalid xml', (done) => {
      Submission.fromXml('<a><b/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.1);
        done();
      });
    });

    it('should reject if the data container does not exist', (done) => {
      Submission.fromXml('<submission><data/></submission>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('data node');
        done();
      });
    });

    it('should reject if the formId does not exist (1: no attribute)', (done) => {
      Submission.fromXml('<submission><data><data/></data></submission>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
        done();
      });
    });

    it('should reject if the formId does not exist (2: blank)', (done) => {
      Submission.fromXml('<submission><data><data id=""><field/></data></data></submission>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
        done();
      });
    });

    it('should reject if the instanceID does not exist (1: no attribute)', (done) => {
      Submission.fromXml('<submission><data><data id="mycoolform"><field/></data></data></submission>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('instance ID xml attribute');
        done();
      });
    });

    it('should reject if the instanceID does not exist (2: blank)', (done) => {
      Submission.fromXml('<submission><data><data id="mycoolform" instanceID=""><field/></data></data></submission>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('instance ID xml attribute');
        done();
      });
    });

    it('should return a populated PartialSubmission given correct xml', (done) => {
      const xml = '<submission><data><data id="mycoolform" instanceID="myinstance"><field/></data></data></submission>';
      Submission.fromXml(xml).then((ps) => {
        ps.complete.should.be.a.Function();
        ps.xmlFormId.should.equal('mycoolform');
        ps.instanceId.should.equal('myinstance');
        ps.xml.should.equal(xml);
        done();
      }).point();
    });
  });

  describe('PartialSubmission', () => {
    const subXml = '<submission><data><data id="mycoolform" instanceID="myinstance"><field/></data></data></submission>';
    const psp = Submission.fromXml(subXml).point();
    it('should complete given a form and no actor', (done) => {
      psp.then((ps) => {
        const submission = ps.complete({ id: 42 }, Option.none());
        submission.instanceId.should.equal('myinstance');
        submission.xml.should.equal(subXml);
        submission.formId.should.equal(42);
        should.not.exist(submission.xmlFormId);
        should.not.exist(submission.submitter);
        done();
      });
    });

    it('should complete given a form and an actor', (done) => {
      psp.then((ps) => {
        const submission = ps.complete({ id: 42 }, Option.of({ id: 75 }));
        submission.instanceId.should.equal('myinstance');
        submission.xml.should.equal(subXml);
        submission.formId.should.equal(42);
        submission.submitter.should.equal(75);
        should.not.exist(submission.xmlFormId);
        done();
      });
    });
  });
});

