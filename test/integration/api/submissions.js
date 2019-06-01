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

    it('should save the submission to the appropriate form without device id', testService((service) =>
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
              should.not.exist(body.deviceId);
            })))));

    it('should save the submission to the appropriate form with device id as null when query string is empty', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission?deviceID=')
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
              should.not.exist(body.deviceId);
            })))));

    it('should save the submission to the appropriate form with device id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission?deviceID=imei%3A358240051111110')
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
              body.deviceId.should.equal('imei:358240051111110');
            })))));

    // also tests /forms/_/submissions/_/attachments return content. (mark1)
    // no point in replicating it.
    it('should save given attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'here_is_file2.jpg', exists: true },
                  { name: 'my_file1.mp4', exists: true }
                ]);
              }))))));

    it('should ignore unknown attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('some_random_file', Buffer.from('this is test file one'), { filename: 'some_random_file' })
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('other_random_file', Buffer.from('this is test file two'), { filename: 'other_random_file' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'here_is_file2.jpg', exists: false },
                  { name: 'my_file1.mp4', exists: false }
                ]);
              }))))));

    it('should detect which attachments are expected', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/one/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([{ name: 'my_file1.mp4', exists: false }]);
              }))))));

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
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
              .expect(201)
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
                .expect(200)
                .then(({ body }) => {
                  body.should.eql([
                    { name: 'here_is_file2.jpg', exists: true },
                    { name: 'my_file1.mp4', exists: true }
                  ]);
                })))))));

    // also tests /forms/_/submissions/_/attachments/_ return content. (mark2)
    // no point in replicating it.
    it('should successfully save attachment binary data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
              .expect(200)
              .then(({ headers, body }) => {
                headers['content-type'].should.equal('video/mp4');
                headers['content-disposition'].should.equal('attachment; filename="my_file1.mp4"');
                body.toString('utf8').should.equal('this is test file one');
              }))))));

    it('should successfully save additionally POSTed attachment binary data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
              .expect(201)
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
                .expect(200)
                .then(({ headers, body }) => {
                  headers['content-type'].should.equal('image/jpeg');
                  headers['content-disposition'].should.equal('attachment; filename="here_is_file2.jpg"');
                  body.toString('utf8').should.equal('this is test file two');
                })))))));
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
            body.submitterId.should.equal(5);
          }))));

    it('should create expected attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'here_is_file2.jpg', exists: false },
                  { name: 'my_file1.mp4', exists: false }
                ]);
              }))))));
  });

  describe('.csv.zip GET', () => {
    it('should return a zipfile with the relevant headers', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip')
          .expect(200)
          .then(({ headers }) => {
            headers['content-disposition'].should.equal('attachment; filename="simple.zip"');
            headers['content-type'].should.equal('application/zip');
          }))));

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
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
              .expect(201))
            .then(() => new Promise((done) =>
              zipStreamToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip'), (result) => {
                result.filenames.should.containDeep([
                  'binaryType.csv',
                  'media/my_file1.mp4',
                  'media/here_is_file2.jpg'
                ]);

                result['media/my_file1.mp4'].should.equal('this is test file one');
                result['media/here_is_file2.jpg'].should.equal('this is test file two');

                done();
              })))))));
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

  describe('/:instanceId/attachments/:name POST', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/nonexistent/submissions/one/attachments/file.jpg')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(404))));

    it('should return notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions/nonexistent/attachments/file.jpg')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(404))));

    it('should reject if the user cannot update a submission', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/projects/1/forms/simple/submissions/one/attachments/file.jpg')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(403))));

    it('should reject if the attachment does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/cool_file3.mp3')
              .set('Content-Type', 'audio/mp3')
              .send('testaudio')
              .expect(404))))));

    it('should attach the given file', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
              .set('Content-Type', 'video/mp4')
              .send('testvideo')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .expect(200)
                .then(({ headers, body }) => {
                  headers['content-type'].should.equal('video/mp4');
                  body.toString().should.equal('testvideo');
                })))))));
  });

  describe('/:instanceId/attachments/:name DELETE', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/nonexistent/submissions/one/attachments/file.jpg')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(404))));

    it('should return notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple/submissions/nonexistent/attachments/file.jpg')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(404))));

    it('should reject if the user cannot update a submission', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.delete('/v1/projects/1/forms/simple/submissions/one/attachments/file.jpg')
          .set('Content-Type', 'image/jpeg')
          .send('testimage')
          .expect(403))));

    it('should clear the given attachment', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
              .set('Content-Type', 'video/mp4')
              .send('testvideo')
              .expect(200)
              .then(() => asAlice.delete('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .expect(200)
                .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                  .expect(404)
                  .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
                    .expect(200)
                    .then(({ body }) =>  {
                      body.should.eql([
                        { name: 'here_is_file2.jpg', exists: false },
                        { name: 'my_file1.mp4', exists: false }
                      ]);
                    })))))))));

    it('should log an audit entry about the deletion', testService((service, { Audit, Project }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
              .set('Content-Type', 'video/mp4')
              .send('testvideo')
              .expect(200)
              .then(() => asAlice.delete('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .expect(200)
                .then(() => Promise.all([
                  asAlice.get('/v1/users/current').expect(200),
                  Project.getById(1)
                    .then((project) => project.get().getFormByXmlFormId('binaryType')),
                  Audit.getLatestWhere({ action: 'submission.attachment.clear' })
                ])
                  .then(([ user, maybeForm, maybeLog ]) => {
                    maybeLog.isDefined().should.equal(true);
                    const log = maybeLog.get();

                    log.actorId.should.equal(user.body.id);
                    log.acteeId.should.equal(maybeForm.get().acteeId);
                    log.details.name.should.equal('my_file1.mp4');
                    log.details.blobId.should.be.a.Number();
                  }))))))));
  });
});

