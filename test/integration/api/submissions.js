const appRoot = require('app-root-path');
const should = require('should');
const { createReadStream, readFileSync } = require('fs');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { zipStreamToFiles } = require('../../util/zip');
const { exhaust } = require(appRoot + '/lib/worker/worker');

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
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/one')
              .expect(200)
              .then(({ body }) => {
                body.createdAt.should.be.a.recentIsoDate();
                should.not.exist(body.deviceId);
              }),
            asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(testData.instances.simple.one); })
          ])))));

    it('should save the submission to the appropriate form with device id as null when query string is empty', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission?deviceID=')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(({ text }) => {
            text.should.match(/upload was successful/);
          })
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/one')
              .expect(200)
              .then(({ body }) => {
                body.createdAt.should.be.a.recentIsoDate();
                should.not.exist(body.deviceId);
              }),
            asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(testData.instances.simple.one); })
          ])))));

    it('should save the submission to the appropriate form with device id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission?deviceID=imei%3A358240051111110')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(({ text }) => {
            text.should.match(/upload was successful/);
          })
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/one')
              .expect(200)
              .then(({ body }) => {
                body.createdAt.should.be.a.recentIsoDate();
              body.deviceId.should.equal('imei:358240051111110');
              }),
            asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(testData.instances.simple.one); })
          ])))));

    it('should store the correct formdef and actor ids', testService((service, { db }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => Promise.all([
            asAlice.get('/v1/users/current').then(({ body }) => body.id),
            db.select('formDefId', 'actorId').from('submission_defs')
          ]))
          .then(([ aliceId, submissions ]) => {
            submissions.length.should.equal(1);
            submissions[0].actorId.should.equal(aliceId);
            return db.select('xml').from('form_defs').where({ id: submissions[0].formDefId })
              .then(([ def ]) => {
                def.xml.should.equal(testData.forms.simple);
              });
          }))));

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

    it('should return an appropriate error given conflicting attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('file1', Buffer.from('this is test file three'), { filename: 'file1' })
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.conflict), { filename: 'data.xml' })
            .attach('file1', Buffer.from('this is test file four'), { filename: 'file1' })
            .expect(409)))));

    it('should create audit log entries for saved attachments', testService((service) =>
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
            .then(() => Promise.all([
              asAlice.get('/v1/audits?action=submission.attachment.update').then(({ body }) => body),
              asAlice.get('/v1/users/current').then(({ body }) => body)
            ]))
            .then(([ audits, alice ]) => {
              audits.length.should.equal(1);
              audits[0].should.be.an.Audit();
              audits[0].actorId.should.equal(alice.id);
              audits[0].details.name.should.equal('my_file1.mp4');
              audits[0].details.instanceId.should.equal('both');
            })))));

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

    // this just ensures that we correctly pick up the attachment and save it. we verify
    // that it's been correctly processed and exports right in the .csv.zip tests below.
    it('should save client audit log attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions/one/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([{ name: 'audit.csv', exists: true }]);
              }))))));

    it('should create empty client audit log slots', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions/one/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([{ name: 'audit.csv', exists: false }]);
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

    it('should accept encrypted submissions, with attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.encrypted)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('submission.xml.enc', Buffer.from('this is test file one'), { filename: 'submission.xml.enc' })
            .attach('1561432508817.jpg.enc', Buffer.from('this is test file two'), { filename: '1561432508817.jpg.enc' })
            // also attach a file that the manifest does not expect.
            .attach('extraneous.enc', Buffer.from('this is test file three'), { filename: 'extraneous.enc' })
            .attach('xml_submission_file', Buffer.from(testData.instances.encrypted.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/encrypted/submissions/uuid:dcf4a151-5088-453f-99e6-369d67828f7a.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(testData.instances.encrypted.one); }),
            asAlice.get('/v1/projects/1/forms/encrypted/submissions/uuid:dcf4a151-5088-453f-99e6-369d67828f7a/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { exists: true, name: '1561432508817.jpg.enc' },
                  { exists: true, name: 'submission.xml.enc' }
                ]);
              }),
            asAlice.get('/v1/projects/1/forms/encrypted/submissions/uuid:dcf4a151-5088-453f-99e6-369d67828f7a/attachments/submission.xml.enc')
              .expect(200)
              .then(({ body }) => { body.toString('utf8').should.equal('this is test file one'); })
          ])))));
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

    it('should store the correct formdef and actor ids', testService((service, { db }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/users/current').then(({ body }) => body.id),
            db.select('formDefId', 'actorId').from('submission_defs')
          ]))
          .then(([ aliceId, submissions ]) => {
            submissions.length.should.equal(1);
            submissions[0].actorId.should.equal(aliceId);
            return db.select('xml').from('form_defs').where({ id: submissions[0].formDefId })
              .then(([ def ]) => {
                def.xml.should.equal(testData.forms.simple);
              });
          }))));

    it('should accept encrypted submissions, with attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.encrypted)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/encrypted/submissions/uuid:dcf4a151-5088-453f-99e6-369d67828f7a.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(testData.instances.encrypted.one); }),
            asAlice.get('/v1/projects/1/forms/encrypted/submissions/uuid:dcf4a151-5088-453f-99e6-369d67828f7a/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { exists: false, name: '1561432508817.jpg.enc' },
                  { exists: false, name: 'submission.xml.enc' }
                ]);
              })
          ])))));
  });

  describe('.csv.zip GET', () => {
    // NOTE: tests related to decryption of .csv.zip export are located in test/integration/other/encryption.js

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
              result['simple.csv'].should.be.a.SimpleCsv();
              done();
            }))))));

    it('should not include data from other forms', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200)),
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
      ])
        .then(() => new Promise((done) =>
          zipStreamToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'), (result) => {
            result.filenames.should.eql([ 'simple.csv' ]);
            const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
            csv.length.should.equal(4); // header + 2 data rows + newline
            csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status' ]);
            csv[1].shift().should.be.an.recentIsoDate();
            csv[1].should.eql([ 'two','Bob','34','two','5','Alice','0','0' ]);
            csv[2].shift().should.be.an.recentIsoDate();
            csv[2].should.eql([ 'one','Alice','30','one','5','Alice','0','0' ]);
            csv[3].should.eql([ '' ]);
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

                // we also check the csv for the sake of verifying the attachments counts.
                const csv = result['binaryType.csv'].split('\n');
                csv[0].should.equal('SubmissionDate,meta-instanceID,file1,file2,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status');
                csv[1].should.endWith(',both,my_file1.mp4,here_is_file2.jpg,both,5,Alice,2,2');
                csv.length.should.equal(3); // newline at end

                done();
              })))))));

    it('should properly count present attachments', testService((service) =>
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
            .then(() => new Promise((done) =>
              zipStreamToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip'), (result) => {
                result.filenames.should.containDeep([
                  'binaryType.csv',
                  'media/my_file1.mp4'
                ]);

                // we also check the csv for the sake of verifying the attachments counts.
                const csv = result['binaryType.csv'].split('\n');
                csv[0].should.equal('SubmissionDate,meta-instanceID,file1,file2,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status');
                csv[1].should.endWith(',both,my_file1.mp4,here_is_file2.jpg,both,5,Alice,1,2');
                csv.length.should.equal(3); // newline at end

                done();
              })))))));

    it('should return worker-processed consolidated client audit log attachments', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
            .expect(201))
          .then(() => exhaust(container))
          .then(() => new Promise((done) =>
            zipStreamToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'), (result) => {
              result.filenames.should.containDeep([
                'audits.csv',
                'media/audit.csv',
                'media/log.csv',
                'audits - audit.csv'
              ]);

              result['audits - audit.csv'].should.equal(`event,node,start,end,latitude,longitude,accuracy,old-value,new-value
a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb
b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd
c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff
d,/data/d,2000-01-01T00:10,,10,11,12,gg,
e,/data/e,2000-01-01T00:11,,,,,hh,ii
f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb
g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd
h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff
`);

              done();
            })))
          .then(() => container.simply.countWhere('client_audits')
            .then((count) => { count.should.equal(8); })))));

    it('should return adhoc-processed consolidated client audit log attachments', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
            .expect(201))
          .then(() => new Promise((done) =>
            zipStreamToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'), (result) => {
              result.filenames.should.containDeep([
                'audits.csv',
                'media/audit.csv',
                'media/log.csv',
                'audits - audit.csv'
              ]);

              result['audits - audit.csv'].should.equal(`event,node,start,end,latitude,longitude,accuracy,old-value,new-value
a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb
b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd
c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff
d,/data/d,2000-01-01T00:10,,10,11,12,gg,
e,/data/e,2000-01-01T00:11,,,,,hh,ii
f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb
g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd
h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff
`);

              done();
            }))))));

    it('should return the latest attached audit log after openrosa replace', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip')
            .expect(200)
            .then(() => new Promise((done) =>
              zipStreamToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'), (result) => {
                result.filenames.should.containDeep([
                  'audits.csv',
                  'media/audit.csv',
                  'audits - audit.csv'
                ]);

                result['audits - audit.csv'].should.equal(`event,node,start,end,latitude,longitude,accuracy,old-value,new-value
f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb
g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd
h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff
`);

                done();
              })))))));

    it('should return the latest attached audit log after REST replace', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/forms/audits/submissions/one/attachments/audit.csv')
            .set('Content-Type', 'text/csv')
            .send(readFileSync(appRoot + '/test/data/audit2.csv'))
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip')
            .expect(200)
            .then(() => new Promise((done) =>
              zipStreamToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'), (result) => {
                result.filenames.should.containDeep([
                  'audits.csv',
                  'media/audit.csv',
                  'audits - audit.csv'
                ]);

                result['audits - audit.csv'].should.equal(`event,node,start,end,latitude,longitude,accuracy,old-value,new-value
f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb
g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd
h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff
`);

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
            })))));
  });

  describe('/keys GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent/submissions/keys').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple/submissions/keys').expect(403))));

    it('should return an empty array if encryption is not being used', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([]);
            })))));

    // a bit of a compound test, since there is no way as of time of writing to verify
    // that the form def key parsing and storage works. so this test catches form /and/
    // submission key handling.
    it('should return a self-managed key if it is used', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/submissions/keys')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.a.Key();
              body[0].public.should.equal('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyYh7bSui/0xppQ+J3i5xghfao+559Rqg9X0xNbdMEsW35CzYUfmC8sOzeeUiE4pG7HIEUmiJal+mo70UMDUlywXj9z053n0g6MmtLlUyBw0ZGhEZWHsfBxPQixdzY/c5i7sh0dFzWVBZ7UrqBc2qjRFUYxeXqHsAxSPClTH1nW47Mr2h4juBLC7tBNZA3biZA/XTPt//hAuzv1d6MGiF3vQJXvFTNdfsh6Ckq4KXUsAv+07cLtON4KjrKhqsVNNGbFssTUHVL4A9N3gsuRGt329LHOKBxQUGEnhMM2MEtvk4kaVQrgCqpk1pMU/4HlFtRjOoKdAIuzzxIl56gNdRUQIDAQAB');
            })))));

    it('should return multiple self-managed keys if they are used', testService((service, { db, Project, FormDef, FormPartial }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => Promise.all([
            Project.getById(1).then((o) => o.get())
              .then((project) => project.getFormByXmlFormId('encrypted')).then((o) => o.get()),
            FormPartial.fromXml(testData.forms.encrypted
              .replace(/PublicKey="[a-z0-9+\/]+"/i, 'PublicKey="keytwo"')
              .replace('working3', 'working4'))
          ]))
          .then(([ form, partial ]) => partial.createVersion(form))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.two
              .replace(/EncryptedKey.*EncryptedKey/, 'EncryptedKey>keytwo</base64EncryptedKey')
              .replace('working3', 'working4'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/submissions/keys')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body[0].should.be.a.Key();
              body[0].public.should.equal('keytwo');
              body[1].should.be.a.Key();
              body[1].public.should.equal('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyYh7bSui/0xppQ+J3i5xghfao+559Rqg9X0xNbdMEsW35CzYUfmC8sOzeeUiE4pG7HIEUmiJal+mo70UMDUlywXj9z053n0g6MmtLlUyBw0ZGhEZWHsfBxPQixdzY/c5i7sh0dFzWVBZ7UrqBc2qjRFUYxeXqHsAxSPClTH1nW47Mr2h4juBLC7tBNZA3biZA/XTPt//hAuzv1d6MGiF3vQJXvFTNdfsh6Ckq4KXUsAv+07cLtON4KjrKhqsVNNGbFssTUHVL4A9N3gsuRGt329LHOKBxQUGEnhMM2MEtvk4kaVQrgCqpk1pMU/4HlFtRjOoKdAIuzzxIl56gNdRUQIDAQAB');
            })))));

    it('should not return unused keys', testService((service, { Project, FormDef, FormPartial }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => Promise.all([
            Project.getById(1).then((o) => o.get())
              .then((project) => project.getFormByXmlFormId('encrypted')).then((o) => o.get()),
            FormPartial.fromXml(testData.forms.encrypted
              .replace(/PublicKey="[a-z0-9+\/]+"/i, 'PublicKey="keytwo"')
              .replace('working3', 'working4'))
          ]))
          .then(([ form, partial ]) => partial.createVersion(form))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/submissions/keys')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.a.Key();
              body[0].public.should.equal('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyYh7bSui/0xppQ+J3i5xghfao+559Rqg9X0xNbdMEsW35CzYUfmC8sOzeeUiE4pG7HIEUmiJal+mo70UMDUlywXj9z053n0g6MmtLlUyBw0ZGhEZWHsfBxPQixdzY/c5i7sh0dFzWVBZ7UrqBc2qjRFUYxeXqHsAxSPClTH1nW47Mr2h4juBLC7tBNZA3biZA/XTPt//hAuzv1d6MGiF3vQJXvFTNdfsh6Ckq4KXUsAv+07cLtON4KjrKhqsVNNGbFssTUHVL4A9N3gsuRGt329LHOKBxQUGEnhMM2MEtvk4kaVQrgCqpk1pMU/4HlFtRjOoKdAIuzzxIl56gNdRUQIDAQAB');
            })))));

    it('should return managed keys, with hint', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(200)
            .then(({ body }) => body.version))
          .then((version) => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.encrypted.one
              .replace('id="encrypted" version="working3"', `id="simple" version="${version}"`))
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.a.Key();
              body[0].managed.should.equal(true);
              body[0].hint.should.equal('it is a secret');
            })))));

    it('should not return a key more than once', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/submissions/keys')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.a.Key();
              body[0].public.should.equal('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyYh7bSui/0xppQ+J3i5xghfao+559Rqg9X0xNbdMEsW35CzYUfmC8sOzeeUiE4pG7HIEUmiJal+mo70UMDUlywXj9z053n0g6MmtLlUyBw0ZGhEZWHsfBxPQixdzY/c5i7sh0dFzWVBZ7UrqBc2qjRFUYxeXqHsAxSPClTH1nW47Mr2h4juBLC7tBNZA3biZA/XTPt//hAuzv1d6MGiF3vQJXvFTNdfsh6Ckq4KXUsAv+07cLtON4KjrKhqsVNNGbFssTUHVL4A9N3gsuRGt329LHOKBxQUGEnhMM2MEtvk4kaVQrgCqpk1pMU/4HlFtRjOoKdAIuzzxIl56gNdRUQIDAQAB');
            })))));

    // TODO: when submission versioning exists, this needs to be tested.
    //it('should not return a key attached to an outdated submission', testService((service) =>
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

    it('should log an audit entry about initial attachment', testService((service, { Audit, Project, Submission, SubmissionAttachment, SubmissionDef }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
            .set('Content-Type', 'video/mp4')
            .send('testvideo')
            .expect(200))
          .then(() => Project.getById(1))
          .then((project) => project.get().getFormByXmlFormId('binaryType'))
          .then((o) => o.get())
          .then((form) => Submission.getById(form.id, 'both')
            .then((o) => o.get())
            .then((submission) => submission.getCurrentVersion()
              .then((o) => o.get())
              .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4')
                .then((o) => o.get())
                .then((attachment) => Promise.all([
                  asAlice.get('/v1/users/current').expect(200),
                  Audit.getLatestWhere({ action: 'submission.attachment.update' })
                ])
                  .then(([ user, maybeLog ]) => {
                    maybeLog.isDefined().should.equal(true);
                    const log = maybeLog.get();

                    log.actorId.should.equal(user.body.id);
                    log.acteeId.should.equal(form.acteeId);
                    log.details.should.eql({
                      instanceId: 'both',
                      submissionDefId: def.id,
                      name: 'my_file1.mp4',
                      oldBlobId: null,
                      newBlobId: attachment.blobId
                    });
                  }))))))));

    it('should log an audit entry about reattachment', testService((service, { Audit, Project, Submission, SubmissionAttachment, SubmissionDef }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
            .set('Content-Type', 'video/mp4')
            .send('testvideo')
            .expect(200))
          .then(() => Project.getById(1))
          .then((project) => project.get().getFormByXmlFormId('binaryType'))
          .then((o) => o.get())
          .then((form) => Submission.getById(form.id, 'both').then((o) => o.get())
            .then((submission) => submission.getCurrentVersion().then((o) => o.get())
              .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4').then((o) => o.get())
                .then((oldAttachment) => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                  .set('Content-Type', 'video/mp4')
                  .send('testvideo2')
                  .expect(200)
                  .then((attachment) => Promise.all([
                    asAlice.get('/v1/users/current').expect(200),
                    SubmissionAttachment.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4').then((o) => o.get()),
                    Audit.getLatestWhere({ action: 'submission.attachment.update' })
                  ])
                    .then(([ user, newAttachment, maybeLog ]) => {
                      maybeLog.isDefined().should.equal(true);
                      const log = maybeLog.get();

                      log.actorId.should.equal(user.body.id);
                      log.acteeId.should.equal(form.acteeId);
                      log.details.should.eql({
                        instanceId: 'both',
                        submissionDefId: def.id,
                        name: 'my_file1.mp4',
                        oldBlobId: oldAttachment.blobId,
                        newBlobId: newAttachment.blobId
                      });
                    })))))))));
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

    it('should log an audit entry about the deletion', testService((service, { Audit, Project, Submission, SubmissionAttachment, SubmissionDef }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
            .set('Content-Type', 'video/mp4')
            .send('testvideo')
            .expect(200))
          .then(() => Project.getById(1))
          .then((project) => project.get().getFormByXmlFormId('binaryType'))
          .then((o) => o.get())
          .then((form) => Submission.getById(form.id, 'both')
            .then((o) => o.get())
            .then((submission) => submission.getCurrentVersion()
              .then((o) => o.get())
              .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4')
                .then((o) => o.get())
                .then((attachment) => asAlice.delete('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                  .expect(200)
                  .then(() => Promise.all([
                    asAlice.get('/v1/users/current').expect(200),
                    Audit.getLatestWhere({ action: 'submission.attachment.update' })
                  ])
                    .then(([ user, maybeLog ]) => {
                      maybeLog.isDefined().should.equal(true);
                      const log = maybeLog.get();

                      log.actorId.should.equal(user.body.id);
                      log.acteeId.should.equal(form.acteeId);
                      log.details.should.eql({
                        instanceId: 'both',
                        submissionDefId: def.id,
                        name: 'my_file1.mp4',
                        oldBlobId: attachment.blobId
                      });
                    })))))))));
  });
});

