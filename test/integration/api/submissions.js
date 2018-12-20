const should = require('should');
const { testService } = require('../setup');
const testData = require('../data');
const { zipStreamToFiles } = require('../../util/zip');

describe('api: /submission', () => {
  describe('HEAD', () => {
    it('should return a 204 with no content', testService((service) =>
      service.head('/v1/projects/1/submission').expect(204)));

    it('should fail on authentication given broken credentials', testService((service) =>
      service.head('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/submission')
        .expect(401)));
  });

  describe('POST', () => {
    it('should reject if no xml file is given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Content-Type', 'text/xml')
          .send(testData.instances.simple2.one)
          .expect(400)
          .then(({ text }) => {
            text.should.match(/Required multipart POST field xml_submission_file missing./);
          }))));

    it('should reject if the xml is not valid', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from('<test'), { filename: 'data.xml' })
          .expect(400)
          .then(({ text }) => { text.should.match(/form ID xml attribute/i); }))));

    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from('<data id="nonexistent"><field/></data>'), { filename: 'data.xml' })
          .expect(404))));

    it('should reject if the user cannot submit', testService((service) =>
      service.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
        .expect(403)));

    it('should reject if the form is not taking submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(409)))));

    it('should reject if the form and submission versions mismatch', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from('<data id="simple" version="-1"><orx:meta><orx:instanceID>one</orx:instanceID></orx:meta></data>'), { filename: 'data.xml' })
          .expect(400)
          .then(({ text }) => {
            text.should.match(/outdated version/);
          }))));

    it('should save the submission to the appropriate form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(({ text }) => {
            text.should.match(/upload was successful/);
          })
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.createdAt.should.be.a.recentIsoDate();
              body.xml.should.equal(testData.instances.simple.one);
            })))));

    // also tests /forms/_/submissions/_/attachments return content. (mark1)
    // no point in replicating it.
    it('should save given attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file2.txt', Buffer.from('this is test file two'), { filename: 'file2.txt' })
          .expect(201)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/attachments')
            .expect(200)
            .then(({ body }) => {
              body.should.containDeep([ 'file1.txt', 'file2.txt' ]);
            })))));

    it('should reject if the xml changes between posts', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from('<data id="simple"><meta><instanceID>one</instanceID></meta></data>'), { filename: 'data.xml' })
            .expect(409)
            .then(({ text }) => {
              text.should.match(/different XML/i);
            })))));

    it('should take in additional attachments via additional POSTs', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .attach('file2.txt', Buffer.from('this is test file two'), { filename: 'file2.txt' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([ 'file1.txt', 'file2.txt' ]);
              }))))));

    it('should reject given conflicting attachment names', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .attach('file1.txt', Buffer.from('this is test file two'), { filename: 'file2.txt' })
          .expect(400)
          .then(({ text }) => {
            text.should.match(/resource already exists with \(attachment file names\) value\(s\) of file1.txt/);
          }))));

    // also tests /forms/_/submissions/_/attachments/_ return content. (mark2)
    // no point in replicating it.
    it('should successfully save attachment binary data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .expect(201)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/attachments/file1.txt')
            .expect(200)
            .then(({ headers, text }) => {
              headers['content-type'].should.equal('text/plain; charset=utf-8');
              headers['content-disposition'].should.equal('attachment; filename="file1.txt"');
              text.should.equal('this is test file one');
            })))));
  });
});

describe('api: /forms/:id/submissions', () => {
  describe('POST', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/nonexistent/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(404))));

    it('should reject if the user cannot submit', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(403))));

    it('should reject if the form is not taking submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(409)))));

    it('should reject if the submission body is not valid xml', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send('<aoeu')
          .set('Content-Type', 'text/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.2);
            body.details.field.should.match(/form ID xml attribute/i);
          }))));

    it('should reject if the form ids do not match', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.8);
            body.details.reason.should.match(/did not match.*url/i);
          }))));

    it('should reject if the form is not taking submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.2);
              body.message.should.match(/not currently accepting submissions/);
            })))));

    it('should reject if the form and submission versions do not match', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(Buffer.from('<data id="simple" version="-1"><meta><instanceID>one</instanceID></meta></data>'))
          .set('Content-Type', 'text/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.8);
            body.details.reason.should.match(/outdated version/);
          }))));

    it('should submit if all details are provided', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Submission();
            body.createdAt.should.be.a.recentIsoDate();
            body.submitter.should.equal(5);
          }))));
  });

  describe('.csv.zip GET', () => {
    it('should return a zipfile with the relevant data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.three)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => new Promise((done) =>
            zipStreamToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'), (result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
              csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName' ]);
              csv[1].shift().should.be.an.recentIsoDate();
              csv[1].should.eql([ 'three','Chelsea','38','three', '5', 'Alice' ]);
              csv[2].shift().should.be.an.recentIsoDate();
              csv[2].should.eql([ 'two','Bob','34','two', '5', 'Alice' ]);
              csv[3].shift().should.be.an.recentIsoDate();
              csv[3].should.eql([ 'one','Alice','30','one', '5', 'Alice' ]);
              done();
            }))))));

    it('should return a zipfile with the relevant attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .attach('file2.txt', Buffer.from('this is test file two'), { filename: 'file2.txt' })
          .expect(201)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.two), { filename: 'data.xml' })
            .attach('file3.txt', Buffer.from('this is test file three'), { filename: 'file3.txt' })
            .expect(201))
          .then(() => new Promise((done) =>
            zipStreamToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'), (result) => {
              result.filenames.should.containDeep([
                'simple.csv',
                'media/file1.txt',
                'media/file2.txt',
                'media/file3.txt'
              ]);

              result['media/file1.txt'].should.equal('this is test file one');
              result['media/file2.txt'].should.equal('this is test file two');
              result['media/file3.txt'].should.equal('this is test file three');

              done();
            }))))));
  });

  describe('GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent/submissions').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple/submissions').expect(403))));

    it('should happily return given no submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions')
          .expect(200)
          .then(({ body }) => {
            body.should.eql([]);
          }))));

    it('should return a list of submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
            .expect(200)
            .then(({ body }) => {
              body.forEach((submission) => submission.should.be.a.Submission());
              body.map((submission) => submission.instanceId).should.eql([ 'two', 'one' ]);
            })))));

    it('should list with extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.an.ExtendedSubmission();
              body[0].submitter.displayName.should.equal('Alice');
              body[0].xml.should.equal('<data id="simple"><meta><instanceID>one</instanceID></meta><name>Alice</name><age>30</age></data>');
            })))));
  });

  describe('/:instanceId.xml GET', () => {
    it('should return submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
            .expect(200)
            .then(({ header, text }) => {
              header['content-type'].should.equal('application/xml; charset=utf-8');
              text.should.equal(testData.instances.simple.one);
            })))));
  });

  describe('/:instanceId GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent/submissions/one').expect(404))));

    it('should return notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/nonexistent').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one').expect(403))))));

    it('should return submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Submission();
              body.createdAt.should.be.a.recentIsoDate();
            })))));

    it('should return with extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.should.be.an.ExtendedSubmission();
              body.submitter.displayName.should.equal('Alice');
              body.xml.should.equal(testData.instances.simple.one);
            })))));
  });

  // NOTE: the happy path here is already well-tested above (search mark1).
  // so we only test unhappy paths.
  describe('/:instanceId/attachments GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent/submissions/one/attachments').expect(404))));

    it('should return notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/nonexistent/attachments').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/attachments').expect(403))))));

    it('should happily return given no attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/attachments')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([]);
            })))));
  });

  // NOTE: the happy path here is already well-tested above (search mark2).
  // so we only test unhappy paths.
  describe('/:instanceId/attachments/:name GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent/submissions/one/attachments/file.txt').expect(404))));

    it('should return notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/nonexistent/attachments/file.txt').expect(404))));

    it('should return notfound if the attachment does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/attachments/file.txt').expect(404)))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file.txt', Buffer.from('this is test file one'), { filename: 'file.txt' })
          .expect(201)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/attachments/file.txt').expect(403))))));
  });
});

