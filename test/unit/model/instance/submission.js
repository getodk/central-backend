const should = require('should');
const Option = require('../../../../lib/util/option');
const { Submission } = require('../../../../lib/model/package').withDefaults();

describe('Submission', () => {
  describe('fromXml', () => {
    /* gh #45 when we have a real xml validator we should re-enable this test:
    it('should reject invalid xml', (done) => {
      Submission.fromXml('<a><b/>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.1);
        done();
      });
    });*/

    it('should reject if the formId does not exist (1: no attribute)', (done) => {
      Submission.fromXml('<data><field/></data>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
        done();
      }).point();
    });

    it('should reject if the formId does not exist (2: blank)', (done) => {
      Submission.fromXml('<data id=""><field/></data>').catch((failure) => {
        failure.isProblem.should.equal(true);
        failure.problemCode.should.equal(400.2);
        failure.problemDetails.field.should.equal('form ID xml attribute');
        done();
      }).point();
    });

    it('should find instanceID in meta', (done) => {
      Submission.fromXml('<data id="mycoolform"><orx:meta><orx:instanceID>idtest</orx:instanceID></orx:meta><field/></data>').then((ps) => {
        ps.instanceId.should.equal('idtest');
        done();
      }).point();
    });

    it('should find instanceID directly in data envelope', (done) => {
      Submission.fromXml('<data id="mycoolform"><instanceID>idtest</instanceID><field/></data>').then((ps) => {
        ps.instanceId.should.equal('idtest');
        done();
      }).point();
    });

    it('should generate an instance id if not found', (done) => {
      Submission.fromXml('<data id="mycoolform"><field/></data>').then((ps) => {
        ps.instanceId.should.be.a.uuid();
        done();
      }).point();
    });

    it('should return a populated PartialSubmission given correct xml', (done) => {
      const xml = '<data id="mycoolform" version="coolest"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      Submission.fromXml(xml).then((ps) => {
        ps.complete.should.be.a.Function();
        ps.xmlFormId.should.equal('mycoolform');
        ps.instanceId.should.equal('myinstance');
        ps.version.should.equal('coolest');
        ps.xml.should.equal(xml);
        done();
      }).point();
    });

    it('should squash null version to empty-string', (done) => {
      const xml = '<data id="mycoolform"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
      Submission.fromXml(xml).then((ps) => {
        (ps.version === '').should.equal(true);
        done();
      }).point();
    });

    it('should work given an xml preamble', (done) => {
      const xml = '<?xml version="1.0"?><data id="mycoolform"><orx:meta><orx:instanceID>myinstance</orx:instanceID></orx:meta><field/></data>';
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
    const subXml = '<data id="mycoolform"><field/></data>';
    const psp = Submission.fromXml(subXml).point();
    it('should complete given a form and no actor', (done) => {
      psp.then((ps) => {
        const submission = ps.complete({ id: 42, version: '' }, Option.none());
        submission.instanceId.should.be.a.uuid();
        submission.xml.should.equal(subXml);
        submission.formId.should.equal(42);
        should.not.exist(submission.xmlFormId);
        should.not.exist(submission.submitter);
        done();
      });
    });

    it('should complete given a form and an actor', (done) => {
      psp.then((ps) => {
        const submission = ps.complete({ id: 42, version: '' }, Option.of({ id: 75 }));
        submission.instanceId.should.be.a.uuid();
        submission.xml.should.equal(subXml);
        submission.formId.should.equal(42);
        submission.submitter.should.equal(75);
        should.not.exist(submission.xmlFormId);
        done();
      });
    });

    it('should fail to complete if the form and submission versions mismatch', (done) => {
      psp.then((ps) => {
        ps.complete({ id: 42, version: '5.0' }, Option.of({ id: 75 }));
      }).catch((ex) => {
        ex.isProblem.should.equal(true);
        ex.problemDetails.field.should.equal('version');
        done();
      });
    });
  });
});

