const should = require('should');
const { DateTime } = require('luxon');
const { validate, parse } = require('fast-xml-parser');
const { testService } = require('../setup');
const testData = require('../data');

describe('api: /submission', () => {
  describe('HEAD', () => {
    it('should return a 204 with no content', testService((service) =>
      service.head('/v1/submission').expect(204)));

    it('should fail on authentication given broken credentials', testService((service) =>
      service.head('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/submission')
        .expect(401)));
  });
});

describe.only('api: /forms/:id/submissions', () => {
  describe('POST', () => {
    it('should reject if no xml file is given', testService((service) =>
      service.post('/v1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .set('Date', DateTime.local().toHTTP())
        .set('Content-Type', 'text/xml')
        .send(testData.instances.simple2.one)
        .expect(400)
        .then(({ text }) => {
          text.should.match(/Required multipart POST field xml_submission_file missing./);
        })));

    it('should reject if the xml is not valid', testService((service) =>
      service.post('/v1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .set('Date', DateTime.local().toHTTP())
        .attach('xml_submission_file', Buffer.from('<test'), { filename: 'data.xml' })
        .expect(400)
        .then(({ text }) => {
          text.should.match(/Could not parse/i);
        })));

    it('should return notfound if the form does not exist', testService((service) =>
      service.post('/v1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .set('Date', DateTime.local().toHTTP())
        .attach('xml_submission_file', Buffer.from('<data id="nonexistent"><field/></data>'), { filename: 'data.xml' })
        .expect(404)));

    it('should reject if the user cannot submit', testService((service) =>
      service.post('/v1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .set('Date', DateTime.local().toHTTP())
        .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
        .expect(403)));

    it('should save the submission to the appropriate form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(({ text }) => {
            validate(text).should.equal(true);
            text.should.match(/upload was successful/);
          })
          .then(() => asAlice.get('/v1/forms/simple/submissions/one')
            .expect(200)
            .then(({ body }) => {
              body.createdAt.should.be.a.recentIsoDate();
              body.xml.should.equal(testData.instances.simple.one);
            })))));

    // also tests /forms/_/submissions/_/attachments return content. (mark1)
    // no point in replicating it.
    it('should save given attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file2.txt', Buffer.from('this is test file two'), { filename: 'file2.txt' })
          .expect(201)
          .then(() => asAlice.get('/v1/forms/simple/submissions/one/attachments')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([ 'file1.txt', 'file2.txt' ]);
            })))));

    it('should reject if the xml changes between posts', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .set('Date', DateTime.local().toHTTP())
            .attach('xml_submission_file', Buffer.from('<data id="simple"><meta><instanceID>one</instanceID></meta></data>'), { filename: 'data.xml' })
            .expect(409)
            .then(({ text }) => {
              text.should.match(/different XML/i);
            })))));

    it('should take in additional attachments via additional POSTs', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .set('Date', DateTime.local().toHTTP())
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .attach('file2.txt', Buffer.from('this is test file two'), { filename: 'file2.txt' })
            .expect(201)
            .then(() => asAlice.get('/v1/forms/simple/submissions/one/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([ 'file1.txt', 'file2.txt' ]);
              }))))));

    it('should reject given conflicting attachment names', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .attach('file1.txt', Buffer.from('this is test file two'), { filename: 'file2.txt' })
          .expect(400)
          .then(({ text }) => {
            text.should.match(/resource already exists with a attachment file name of file1.txt/);
          }))));

    // also tests /forms/_/submissions/_/attachments/_ return content. (mark2)
    // no point in replicating it.
    it('should successfully save attachment binary data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .attach('file1.txt', Buffer.from('this is test file one'), { filename: 'file1.txt' })
          .expect(201)
          .then(() => asAlice.get('/v1/forms/simple/submissions/one/attachments/file1.txt')
            .expect(200)
            .then(({ headers, text }) => {
              headers['content-type'].should.equal('text/plain; charset=utf-8');
              headers['content-disposition'].should.equal('attachment; filename=file1.txt');
              text.should.equal('this is test file one');
            })))));
  });
});

