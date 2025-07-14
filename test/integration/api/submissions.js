const appRoot = require('app-root-path');
const should = require('should');
const uuid = require('uuid').v4;
const { sql } = require('slonik');
const { createReadStream, readFileSync } = require('fs');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const { httpZipResponseToFiles } = require('../../util/zip');
const { map } = require('ramda');
const { Form } = require(appRoot + '/lib/model/frames');
const { exhaust } = require(appRoot + '/lib/worker/worker');

// utilities used for versioning instances
const withSimpleIds = (deprecatedId, instanceId) => testData.instances.simple.one
  .replace('one</instance', `${instanceId}</instanceID><deprecatedID>${deprecatedId}</deprecated`);
const withBinaryIds = (deprecatedId, instanceId) => testData.instances.binaryType.both
  .replace('both</instance', `${instanceId}</instanceID><deprecatedID>${deprecatedId}</deprecated`);

describe('api: /submission', () => {
  describe('HEAD', () => {
    it('should return a 204 with no content', testService((service) =>
      service.head('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .expect(204)));

    it('should fail if not given X-OpenRosa-Version header', testService((service) =>
      service.head('/v1/projects/1/submission')
        .expect(400)));

    it('should fail on authentication given broken credentials', testService((service) =>
      service.head('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .expect(403)));
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

    it('should reject if "Multipart: Boundary not found"', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Content-Type', 'multipart/form-data') // missing suffix: "; boundary=..."
          .expect(400)
          .then(({ body }) => {
            body.should.eql({
              code: 400.39,
              message: 'Multipart form content failed to parse.',
              details: 'Multipart: Boundary not found',
            });
          }))));

    it('should reject if "Unexpected end of form"', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Content-Type', 'multipart/form-data; boundary=----geckoformboundary57597312afb59088b78af2a1fdc6038')
          .send('') // should at minimum have a final boundary
          .expect(400)
          .then(({ body }) => {
            body.should.eql({
              code: 400.39,
              message: 'Multipart form content failed to parse.',
              details: 'Unexpected end of form',
            });
          }))));

    it('should reject if "Malformed part header"', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .set('Content-Type', 'multipart/form-data; boundary=BOUNDARY')
          .send(
            '--BOUNDARY\r\n' +
            'Content-Disposition: form-data; name="xml_submission_file"; filename="xml_submission_file"\r\n' +
            'Content-Type: text/xml\r\n\r\n' +
            '--BOUNDARY\r\n' +
            'Content-Disposition: form-data; name="__csrf"\r\n\r\n' +
            'content\r\n' +
            '--BOUNDARY\r\n' +
            'Content-Disposition: form-data; name="699-536x354-9_4_59.jpg"; filename="699-536x354-9_4_59.jpg"\r\n' +
            'Content-Type: image/jpeg\r\n\r\n' +
            // content should be here
            '--BOUNDARY--\r\n\r\n'
          )
          .expect(400)
          .then(({ body }) => {
            body.should.eql({
              code: 400.39,
              message: 'Multipart form content failed to parse.',
              details: 'Malformed part header',
            });
          }))));

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
        .expect(401)));

    it('should reject if the form is not taking submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(409)))));

    it('should reject if the submission version does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from('<data id="simple" version="-1"><orx:meta><orx:instanceID>one</orx:instanceID></orx:meta></data>'), { filename: 'data.xml' })
          .expect(404)
          .then(({ text }) => {
            text.should.match(/The form version specified in this submission/);
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

    it('should save the submission to the appropriate form with device id and user agent', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission?deviceID=imei%3A358240051111110')
          .set('X-OpenRosa-Version', '1.0')
          .set('User-Agent', 'central/test')
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
            asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions')
              .expect(200)
              .then(({ body }) => {
                body[0].deviceId.should.equal('imei:358240051111110');
                body[0].userAgent.should.equal('central/test');
              }),
            asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(testData.instances.simple.one); })
          ])))));

    it('should accept a submission for an old form version', testService((service, { Submissions, one }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=three')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from('<data id="simple" version="two"><orx:meta><orx:instanceID>one</orx:instanceID></orx:meta></data>'), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .expect(200))
          // the submission worked, that's good. the rest of this checks that it went
          // to the correct place.
          .then(() => Submissions.getCurrentDefByIds(1, 'simple', 'one', false))
          .then((o) => o.get())
          .then(({ formDefId }) => one(sql`select * from form_defs where id=${formDefId}`))
          .then((formDef) => { formDef.version.should.equal('two'); }))));

    it('should store the correct formdef and actor ids', testService((service, { all, oneFirst }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => Promise.all([
            asAlice.get('/v1/users/current').then(({ body }) => body.id),
            all(sql`select "formDefId", "submitterId" from submission_defs`)
          ]))
          .then(([ aliceId, submissions ]) => {
            submissions.length.should.equal(1);
            submissions[0].submitterId.should.equal(aliceId);
            return oneFirst(sql`select xml from form_defs where id=${submissions[0].formDefId}`)
              .then((xml) => {
                xml.should.equal(testData.forms.simple);
              });
          }))));

    // also tests /forms/_/submissions/_/attachments return content. (mark1)
    // no point in replicating it.
    it('should save given attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should save attachments with unicode / non-english char', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200);

      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.unicode), { filename: 'data.xml' })
        .attach('fîlé2', Buffer.from('this is test file one'), { filename: 'fîlé2.bin' })
        .attach('f😂le3صادق', Buffer.from('this is test file two'), { filename: 'f😂le3صادق' })
        .expect(201);

      await asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
        .expect(200)
        .then(({ body }) => {
          body.should.eql([
            { name: 'fîlé2', exists: true },
            { name: 'f😂le3صادق', exists: true }
          ]);
        });

      await asAlice.get(`/v1/projects/1/forms/binaryType/submissions/both/attachments/${encodeURI('fîlé2')}`)
        .expect(200)
        .then(({ body }) => {
          body.toString('utf8').should.be.eql('this is test file one');
        });

      await asAlice.get(`/v1/projects/1/forms/binaryType/submissions/both/attachments/${encodeURI('f😂le3صادق')}`)
        .expect(200)
        .then(({ body }) => {
          body.toString('utf8').should.be.eql('this is test file two');
        });

    }));

    it('should not fail given identical attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('my_file1.mp4', Buffer.from('this is a test file'), { filename: 'my_file1.mp4' })
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('here_is_file2.jpg', Buffer.from('this is a test file'), { filename: 'here_is_file2.jpg' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'here_is_file2.jpg', exists: true },
                  { name: 'my_file1.mp4', exists: true }
                ]);
              }))))));

    it('should not fail given identical attachment references', testService((service) => // gh330
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('my_file1.mp4', Buffer.from('this is a test file'), { filename: 'my_file1.mp4' })
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both
              .replace('here_is_file2.jpg', 'my_file1.mp4')), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([{ name: 'my_file1.mp4', exists: true }]);
              }))))));

    it('should create audit log entries for saved attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/bone/attachments')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
                headers['content-disposition'].should.equal('attachment; filename="my_file1.mp4"; filename*=UTF-8\'\'my_file1.mp4');
                headers['etag'].should.equal('"75f5701abfe7de8202cecaa0ca753f29"'); // eslint-disable-line dot-notation
                body.toString('utf8').should.equal('this is test file one');
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
              .set('If-None-Match', '"75f5701abfe7de8202cecaa0ca753f29"')
              .expect(304))))));

    it('should successfully save additionally POSTed attachment binary data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
                  headers['content-disposition'].should.equal('attachment; filename="here_is_file2.jpg"; filename*=UTF-8\'\'here_is_file2.jpg');
                  headers['etag'].should.equal('"25bdb03b7942881c279788575997efba"'); // eslint-disable-line dot-notation
                  body.toString('utf8').should.equal('this is test file two');
                }))
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
                .set('If-None-Match', '"25bdb03b7942881c279788575997efba"')
                .expect(304)))))));

    it('should successfully save additionally POSTed attachment binary data with s3 enabled', testService((service, { Blobs }) => {
      global.s3.enableMock();
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
                  headers['content-disposition'].should.equal('attachment; filename="here_is_file2.jpg"; filename*=UTF-8\'\'here_is_file2.jpg');
                  headers['etag'].should.equal('"25bdb03b7942881c279788575997efba"'); // eslint-disable-line dot-notation
                  body.toString('utf8').should.equal('this is test file two');
                }))
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
                .set('If-None-Match', '"25bdb03b7942881c279788575997efba"')
                .expect(304))
              .then(() => Blobs.s3UploadPending()
                .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
                  .expect(307)
                  .then(({ headers, body }) => {
                    // TODO content-type should not be present at all, but response.removeHeader() does not seem to have an effect
                    headers['content-type'].should.equal('text/plain; charset=utf-8');
                    should(headers['content-disposition']).be.undefined();
                    should(headers.etag).be.undefined();

                    const { location } = headers;
                    location.should.equal('s3://mock/25bdb03b7942881c279788575997efba/eba799d1dc156c0df70f7bad65f815928b98aa7d/here_is_file2.jpg?contentType=image/jpeg');
                    body.should.deepEqual({}); // not sure why
                  }))
                .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
                  .set('If-None-Match', '"25bdb03b7942881c279788575997efba"')
                  .expect(307)
                  .then(({ headers, body }) => {
                    // TODO content-type should not be present at all, but response.removeHeader() does not seem to have an effect
                    headers['content-type'].should.equal('text/plain; charset=utf-8');
                    should(headers['content-disposition']).be.undefined();
                    should(headers.etag).be.undefined();

                    const { location } = headers;
                    location.should.equal('s3://mock/25bdb03b7942881c279788575997efba/eba799d1dc156c0df70f7bad65f815928b98aa7d/here_is_file2.jpg?contentType=image/jpeg');
                    body.should.deepEqual({}); // not sure why
                  }))))));
    }));

    it('should accept encrypted submissions, with attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should reject resubmission of soft-deleted submission', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
        .expect(201);

      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);

      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
        .expect(409)
        .then(({ text }) => {
          text.should.match(/This submission has been deleted. You may not resubmit it./);
        });
    }));

    context('versioning', () => {
      it('should reject if the deprecatedId is not known', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('unknown', 'two')), { filename: 'data.xml' })
              .expect(404)))));

      it('should reject if the deprecatedId is not current', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two')), { filename: 'data.xml' })
              .expect(201))
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'three')), { filename: 'data.xml' })
              .expect(409)
              .then(({ text }) => {
                text.includes('but the copy you were editing (one) is now out of date').should.equal(true);
              })))));

      it('should reject if the new instanceId is a duplicate', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two')), { filename: 'data.xml' })
              .expect(201))
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('two', 'one')), { filename: 'data.xml' })
              .expect(409)
              .then(({ text }) => {
                text.includes('A resource already exists with instanceID value(s) of one.').should.equal(true);
              })))));

      it('should not reject for an instanceID conflict on another form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.withrepeat.one.replace('rone', 'one')), { filename: 'data.xml' })
              .expect(201)))));

      it('should accept the new submission', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two').replace('Alice', 'Alyssa')), { filename: 'data.xml' })
              .expect(201))
            .then(() => asAlice.get('/v1/projects/1/forms/simple.svc/Submissions')
              .then(({ body }) => {
                body.value[0].name.should.equal('Alyssa');
              })))));

      // TODO should be re-instated as part of https://github.com/getodk/central-backend/issues/469
      it.skip('should accept submission update for a closing form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.patch('/v1/projects/1/forms/simple')
              .send({ state: 'closing' })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two').replace('Alice', 'Alyssa')), { filename: 'data.xml' })
              .expect(201))
            .then(() => asAlice.get('/v1/projects/1/forms/simple.svc/Submissions')
              .then(({ body }) => {
                body.value[0].name.should.equal('Alyssa');
              })))));

      // TODO should be re-instated as part of https://github.com/getodk/central-backend/issues/469
      it.skip('should accept submission update for a closed form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.patch('/v1/projects/1/forms/simple')
              .send({ state: 'closed' })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two').replace('Alice', 'Alyssa')), { filename: 'data.xml' })
              .expect(201))
            .then(() => asAlice.get('/v1/projects/1/forms/simple.svc/Submissions')
              .then(({ body }) => {
                body.value[0].name.should.equal('Alyssa');
              })))));

      it('should set the submission review state to edited', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two').replace('Alice', 'Alyssa')), { filename: 'data.xml' })
              .expect(201))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
              .then(({ body }) => {
                body.reviewState.should.equal('edited');
              })))));

      it('should copy forward missing attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'text/xml')
            .send(testData.forms.binaryType)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
              .expect(201)
              .then(() => asAlice.post('/v1/projects/1/submission')
                .set('X-OpenRosa-Version', '1.0')
                .attach('xml_submission_file', Buffer.from(withBinaryIds('both', 'both2')), { filename: 'data.xml' })
                .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
                .expect(201))
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
                .then(({ body }) => {
                  body.should.eql([
                    { name: 'here_is_file2.jpg', exists: true },
                    { name: 'my_file1.mp4', exists: true }
                  ]);
                }))))));

      it('should replace extant attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'text/xml')
            .send(testData.forms.binaryType)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
              .expect(201)
              .then(() => asAlice.post('/v1/projects/1/submission')
                .set('X-OpenRosa-Version', '1.0')
                .attach('xml_submission_file', Buffer.from(withBinaryIds('both', 'both2')), { filename: 'data.xml' })
                .attach('here_is_file2.jpg', Buffer.from('this is test file two two'), { filename: 'here_is_file2.jpg' })
                .expect(201))
              .then(() => Promise.all([
                asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
                  .then(({ body }) => {
                    body.should.eql([
                      { name: 'here_is_file2.jpg', exists: true },
                      { name: 'my_file1.mp4', exists: false }
                    ]);
                  }),
                asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
                  .then(({ body }) => { body.toString('utf8').should.equal('this is test file two two'); })
              ]))))));

      it('should upsert attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'text/xml')
            .send(testData.forms.binaryType)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
              .expect(201)
              .then(() => asAlice.post('/v1/projects/1/submission')
                .set('X-OpenRosa-Version', '1.0')
                .attach('xml_submission_file', Buffer.from(withBinaryIds('both', 'both2')), { filename: 'data.xml' })
                .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
                .expect(201))
              .then(() => asAlice.post('/v1/projects/1/submission')
                .set('X-OpenRosa-Version', '1.0')
                .attach('xml_submission_file', Buffer.from(withBinaryIds('both', 'both2')), { filename: 'data.xml' })
                .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
                .expect(201))
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
                .then(({ body }) => {
                  body.should.eql([
                    { name: 'here_is_file2.jpg', exists: true },
                    { name: 'my_file1.mp4', exists: true }
                  ]);
                }))))));
    });
  });

  describe('[draft] POST', () => {
    // the above tests check extensively the different cases; here we just verify plumbing
    // and correct-sorting of draft submissions.

    it('should reject notfound if there is no draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(404))));

    it('should save the submission into the form draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(({ text }) => {
              text.should.match(/upload was successful/);
            })
            .then(() => Promise.all([
              asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
                .expect(200)
                .then(({ body }) => {
                  body.createdAt.should.be.a.recentIsoDate();
                  should.not.exist(body.deviceId);
                }),
              asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
                .expect(200)
                .then(({ text }) => { text.should.equal(testData.instances.simple.one); }),
              asAlice.get('/v1/projects/1/forms/simple/submissions/one')
                .expect(404)
            ]))))));

    // TODO should be re-instated as part of https://github.com/getodk/central-backend/issues/469
    it.skip('should save a submission for the draft of a closing form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closing' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(({ text }) => {
              text.should.match(/upload was successful/);
            })
            .then(() => Promise.all([
              asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
                .expect(200)
                .then(({ body }) => {
                  body.createdAt.should.be.a.recentIsoDate();
                  should.not.exist(body.deviceId);
                }),
              asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
                .expect(200)
                .then(({ text }) => { text.should.equal(testData.instances.simple.one); }),
              asAlice.get('/v1/projects/1/forms/simple/submissions/one')
                .expect(404)
            ]))))));

    // TODO should be re-instated as part of https://github.com/getodk/central-backend/issues/469
    it.skip('should save a submission for the draft of a closed form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(201)
            .then(({ text }) => {
              text.should.match(/upload was successful/);
            })
            .then(() => Promise.all([
              asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
                .expect(200)
                .then(({ body }) => {
                  body.createdAt.should.be.a.recentIsoDate();
                  should.not.exist(body.deviceId);
                }),
              asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
                .expect(200)
                .then(({ text }) => { text.should.equal(testData.instances.simple.one); }),
              asAlice.get('/v1/projects/1/forms/simple/submissions/one')
                .expect(404)
            ]))))));

    it('should save client audit log attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/audits/draft/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201)
            .then(() => asAlice.get('/v1/projects/1/forms/audits/draft/submissions/one/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([{ name: 'audit.csv', exists: true }]);
              }))))));
  });

  describe('[draft] /test POST', () => {
    // the above tests check extensively the different cases; here we just verify plumbing
    // and correct-sorting of draft submissions.

    it('should reject notfound if there is no draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(404))));

    it('should reject if the draft has been published', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(({ body }) => body.draftToken))
          .then((token) => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200)
            .then(() => service.post(`/v1/test/${token}/projects/1/forms/simple/draft/submission`)
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
              .expect(404))))));

    it('should reject if the draft has been deleted', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(({ body }) => body.draftToken))
          .then((token) => asAlice.delete('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.post(`/v1/test/${token}/projects/1/forms/simple/draft/submission`)
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
              .expect(404))))));

    it('should reject if the key is wrong', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => service.post('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
            .expect(404)))));

    it('should save the submission into the form draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(({ body }) => body.draftToken)
            .then((token) => service.post(`/v1/test/${token}/projects/1/forms/simple/draft/submission`)
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
              .expect(201)
              .then(({ text }) => {
                text.should.match(/upload was successful/);
              })
              .then(() => Promise.all([
                asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
                  .expect(200)
                  .then(({ body }) => {
                    body.createdAt.should.be.a.recentIsoDate();
                    should.not.exist(body.deviceId);
                  }),
                asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
                  .expect(200)
                  .then(({ text }) => { text.should.equal(testData.instances.simple.one); }),
                asAlice.get('/v1/projects/1/forms/simple/submissions/one')
                  .expect(404)
              ])))))));
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
          .send('<data id="simple3"><meta><instanceID>three</instanceID></meta></data>')
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

    it('should reject if the submission version does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(Buffer.from('<data id="simple" version="-1"><meta><instanceID>one</instanceID></meta></data>'))
          .set('Content-Type', 'text/xml')
          .expect(404)
          .then(({ body }) => {
            body.code.should.equal(404.6);
            body.message.should.match(/The form version specified in this submission/);
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

    it('should record a deviceId and userAgent if given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions?deviceID=testtest')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .set('User-Agent', 'central/test')
          .expect(200)
          .then(({ body }) => {
            body.deviceId.should.equal('testtest');
          })
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions')
            .expect(200)
            .then(({ body }) => {
              body[0].deviceId.should.equal('testtest');
              body[0].userAgent.should.equal('central/test');
            })))));

    const lengthyUserAgent = 'Enketo/7.5.1 Mozilla/5.0 (iPhone; CPU iPhone OS 18_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22E252 [FBAN/FBIOS;FBAV/512.0.0.52.99;FBBV/731098301;FBDV/iPhone15,4;FBMD/iPhone;FBSN/iOS;FBSV/18.4.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/733464354;IABMV/1]';
    const lengthyDeviceId = 'Lorem Ipsum: In ea cillum aliqua voluptate est non aute aute dolor. Non amet sit deserunt amet quis qui voluptate ad dolor magna do adipisicing. Laboris mollit anim exercitation anim Lorem ullamco culpa nulla sit qui. Occaecat laboris minim ea ut laboris mollit quis. Proident pariatur Lorem adipisicing nisi enim minim.';
    it('should not fail if longer userAgent and deviceId is provided', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/forms/simple/submissions?deviceID=${lengthyDeviceId}`)
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .set('User-Agent', lengthyUserAgent)
          .expect(200)
          .then(({ body }) => {
            body.deviceId.should.startWith('Lorem Ipsum');
          })
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions')
            .expect(200)
            .then(({ body }) => {
              body[0].deviceId.should.startWith('Lorem Ipsum');
              body[0].userAgent.should.startWith('Enketo/7.5.1');
            })))));

    it('should accept a submission for an old form version', testService((service, { Submissions, one }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=three')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send('<data id="simple" version="two"><orx:meta><orx:instanceID>one</orx:instanceID></orx:meta></data>')
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .expect(200))
          // the submission worked, that's good. the rest of this checks that it went
          // to the correct place.
          .then(() => Submissions.getCurrentDefByIds(1, 'simple', 'one', false))
          .then((o) => o.get())
          .then(({ formDefId }) => one(sql`select * from form_defs where id=${formDefId}`))
          .then((formDef) => { formDef.version.should.equal('two'); }))));

    it('should create expected attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should store the correct formdef and actor ids', testService((service, { all, oneFirst }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/users/current').then(({ body }) => body.id),
            all(sql`select "formDefId", "submitterId" from submission_defs`)
          ]))
          .then(([ aliceId, submissions ]) => {
            submissions.length.should.equal(1);
            submissions[0].submitterId.should.equal(aliceId);
            return oneFirst(sql`select xml from form_defs where id=${submissions[0].formDefId}`)
              .then((xml) => { xml.should.equal(testData.forms.simple); });
          }))));

    it('should accept encrypted submissions, with attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should reject duplicate submissions', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'text/xml')
        .expect(409);
    }));
  });

  describe('[draft] POST', () => {
    it('should return notfound if there is no draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(404))));

    it('should accept submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Submission();
              body.createdAt.should.be.a.recentIsoDate();
              body.submitterId.should.equal(5);
            })))));

    it('should accept even if the form is not taking submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closed' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Submission();
              body.createdAt.should.be.a.recentIsoDate();
              body.submitterId.should.equal(5);
            }))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/one').expect(404),
            asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one').expect(200)
          ])))));

    it('should accept even if the version in the submission is wrong', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(Buffer.from('<data id="simple" version="-1"><meta><instanceID>one</instanceID></meta></data>'))
            .set('Content-Type', 'application/xml')
            .expect(200)))));
  });

  describe('/:instanceId PUT', () => {
    it('should reject notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.put('/v1/projects/1/forms/simple/submissions/one')
          .set('Content-Type', 'text/xml')
          .send(withSimpleIds('one', 'two'))
          .expect(404))));

    it('should reject if the user cannot edit', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.put('/v1/projects/1/forms/simple/submissions/one')
              .set('Content-Type', 'text/xml')
              .send(withSimpleIds('one', 'two'))
              .expect(403))))));

    it('should update the submission', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .set('user-agent', 'node1')
          .expect(200)
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .set('Content-Type', 'text/xml')
            .send(withSimpleIds('one', 'two'))
            .set('user-agent', 'node2')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Submission();
              body.instanceId.should.be.eql('one');
              body.currentVersion.instanceId.should.be.eql('two');

              body.userAgent.should.be.eql('node1');
              body.currentVersion.userAgent.should.be.eql('node2');
            }))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
            .expect(200)
            .then(({ text }) => { text.should.equal(withSimpleIds('one', 'two')); })))));

    it('should reject if the deprecated submission is not current', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .set('Content-Type', 'text/xml')
            .send(withSimpleIds('one', 'two'))
            .expect(200))
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .set('Content-Type', 'text/xml')
            .send(withSimpleIds('one', 'three'))
            .expect(409)))));

    it('should copy forward matching attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'text/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
            .set('Content-Type', 'application/octet-stream')
            .send('this is a test file nr 1')
            .expect(200))
          .then(() => asAlice.put('/v1/projects/1/forms/binaryType/submissions/both')
            .set('Content-Type', 'text/xml')
            .send(withBinaryIds('both', 'two'))
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([
                { name: 'here_is_file2.jpg', exists: false },
                { name: 'my_file1.mp4', exists: true }
              ]);
            })))));
  });

  describe('/:instanceId/edit GET', () => {
    it('should reject if the submission does not exist', testService((service, { run }) =>
      run(sql`update forms set "enketoId"='myenketoid'`)
        .then(() => service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/simple/submissions/one/edit')
            .expect(404)))));

    it('should reject if the form does not have an enketoId', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/edit')
            .expect(409)))));

    it('should reject if the form is closing', testService((service, { run }) =>
      run(sql`update forms set "enketoId"='myenketoid'`)
        .then(() => service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.patch('/v1/projects/1/forms/simple')
              .send({ state: 'closing' })
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/edit')
              .expect(409)
              .then(({ body }) => {
                body.code.should.equal(409.12);
                /trying to edit a submission of a Form that is in Closing or Closed/.test(body.message).should.equal(true);
              }))))));

    it('should redirect to the edit_url', testService((service, { run }) =>
      run(sql`update forms set "enketoId"='myenketoid'`)
        .then(() => service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/edit')
              .expect(302)
              .then(({ text }) => { text.should.equal('Found. Redirecting to https://enketo/edit/url'); }))))));

    // TODO: okay, so it'd be better if this were a true true integration test.
    it('should pass the appropriate parameters to the enketo module', testService((service, { run }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'text/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
            .set('Content-Type', 'application/octet-stream')
            .send('this is a test file nr 1')
            .expect(200))
          .then(() => run(sql`update forms set "enketoId"='myenketoid'`))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/edit')
            .expect(302))
          .then(() => {
            const { editData } = global.enketo;
            editData.openRosaUrl.should.equal('http://localhost:8989/v1/projects/1');
            editData.domain.should.equal('http://localhost:8989');
            editData.logicalId.should.equal('both');
            editData.attachments.length.should.equal(2);
            editData.token.should.be.a.token();
          }))));
  });

  describe('/:instanceId PATCH', () => {
    it('should reject notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(404))));

    it('should reject if the user cannot update', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.patch('/v1/projects/1/forms/simple/submissions/one')
              .send({ reviewState: 'approved' })
              .expect(403))))));

    it('should set the review state', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
            .send({ reviewState: 'approved' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .expect(200)
            .then(({ body }) => { body.reviewState.should.equal('approved'); })))));
  });

  describe('/:instanceId DELETE', () => {
    it('should reject notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
          .expect(404))));

    it('should reject if the user cannot delete', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.delete('/v1/projects/1/forms/simple/submissions/one')
              .expect(403))))));

    it('should soft-delete the submission and not be able to access it again', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .expect(404)))));

    it('should not let a draft submission be deleted', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms/simple/draft');
      await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
      // draft submission delete resource does not exist
      await asAlice.delete('/v1/projects/1/forms/simple/draft/submissions/one')
        .expect(404);
    }));

    it('should not let a submission with the same instanceId as a deleted submission be sent', testServiceFullTrx(async (service, { Submissions }) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(409);

      // once purged, the submission can be sent in again
      await Submissions.purge(true);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));

    it('should delete and restore non-draft submission even when draft submission with same instanceId exists', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // make a draft submission with the same instanceId
      await asAlice.post('/v1/projects/1/forms/simple/draft');
      await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // does not effect delete and restore of non-draft submission
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions/one/restore')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);
    }));
  });

  describe('/:instanceId RESTORE', () => {
    it('should reject if the submission has not been deleted', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/restore')
            .expect(404)))));

    it('should reject if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions/nonexistant/restore')
          .expect(404))));

    it('should reject if the user cannot restore', testService(async (service) => {
      const asAlice = await service.login('alice');
      const asChelsea = await service.login('chelsea');

      // Create a submission
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Delete the submission
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);

      // Chelsea cannot restore
      await asChelsea.post('/v1/projects/1/forms/simple/submissions/one/restore')
        .expect(403);
    }));

    it('should soft-delete the submission and then restore it', testService(async (service) => {
      const asAlice = await service.login('alice');

      // Create a submission
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Delete the submission
      await asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);

      // Accessing the submission should 404
      await asAlice.get('/v1/projects/1/forms/simple/submissions/one')
        .expect(404);

      // Restore the submission
      await asAlice.post('/v1/projects/1/forms/simple/submissions/one/restore')
        .expect(200);

      // Accessing the submission should 200
      await asAlice.get('/v1/projects/1/forms/simple/submissions/one')
        .expect(200);
    }));
  });

  describe('.csv.zip GET', () => {
    // NOTE: tests related to decryption of .csv.zip export are located in test/integration/other/encryption.js

    it('should return a zipfile with the relevant headers', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip')
          .expect(200)
          .then(({ headers }) => {
            headers['content-disposition'].should.equal('attachment; filename="simple.zip"; filename*=UTF-8\'\'simple.zip');
            headers['content-type'].should.equal('application/zip');
          }))));

    it('should return the csv header even if there is no data', testService((service) =>
      service.login('alice', (asAlice) => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
        .then((result) => {
          result.filenames.should.eql([ 'simple.csv' ]);
          result.files.get('simple.csv').should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion\n');
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
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              result.files.get('simple.csv').should.be.a.SimpleCsv();
            })))));

    it('should include all repeat rows @slow', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(`
<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<h:head><h:title>single-repeat-1-instance-10qs</h:title><model odk:xforms-version="1.0.0">
<instance><data id="single-repeat-1-instance-10qs"><q1/><q2/><q3/><q4/><q5/><q6/><q7/><q8/><q9/><q10/><q11/><q12/><q13/><q14/><q15/><q16/><q17/><q18/><q19/><q20/><q21/><repeat jr:template=""><q22/><q23/><q24/><q25/><q26/><q27/><q28/><q29/><q30/><q31/><q32/><q33/><q34/><q35/><q36/><q37/><q38/><q39/><q40/><q41/></repeat><repeat><q22/><q23/><q24/><q25/><q26/><q27/><q28/><q29/><q30/><q31/><q32/><q33/><q34/><q35/><q36/><q37/><q38/><q39/><q40/><q41/></repeat><q42/><q43/><q44/><q45/><q46/><q47/><q48/><q49/><q50/><meta><instanceID/></meta></data></instance>
<bind nodeset="/data/q1" type="string"/><bind nodeset="/data/q2" type="string"/><bind nodeset="/data/q3" type="string"/><bind nodeset="/data/q4" type="string"/><bind nodeset="/data/q5" type="string"/><bind nodeset="/data/q6" type="string"/><bind nodeset="/data/q7" type="string"/><bind nodeset="/data/q8" type="string"/><bind nodeset="/data/q9" type="string"/><bind nodeset="/data/q10" type="string"/><bind nodeset="/data/q11" type="string"/><bind nodeset="/data/q12" type="string"/><bind nodeset="/data/q13" type="string"/><bind nodeset="/data/q14" type="string"/><bind nodeset="/data/q15" type="string"/><bind nodeset="/data/q16" type="string"/><bind nodeset="/data/q17" type="string"/><bind nodeset="/data/q18" type="string"/><bind nodeset="/data/q19" type="string"/><bind nodeset="/data/q20" type="string"/><bind nodeset="/data/q21" type="string"/><bind nodeset="/data/repeat/q22" type="string"/><bind nodeset="/data/repeat/q23" type="string"/><bind nodeset="/data/repeat/q24" type="string"/><bind nodeset="/data/repeat/q25" type="string"/><bind nodeset="/data/repeat/q26" type="string"/><bind nodeset="/data/repeat/q27" type="string"/><bind nodeset="/data/repeat/q28" type="string"/><bind nodeset="/data/repeat/q29" type="string"/><bind nodeset="/data/repeat/q30" type="string"/><bind nodeset="/data/repeat/q31" type="string"/><bind nodeset="/data/repeat/q32" type="string"/><bind nodeset="/data/repeat/q33" type="string"/><bind nodeset="/data/repeat/q34" type="string"/><bind nodeset="/data/repeat/q35" type="string"/><bind nodeset="/data/repeat/q36" type="string"/><bind nodeset="/data/repeat/q37" type="string"/><bind nodeset="/data/repeat/q38" type="string"/><bind nodeset="/data/repeat/q39" type="string"/><bind nodeset="/data/repeat/q40" type="string"/><bind nodeset="/data/repeat/q41" type="string"/><bind nodeset="/data/q42" type="string"/><bind nodeset="/data/q43" type="string"/><bind nodeset="/data/q44" type="string"/><bind nodeset="/data/q45" type="string"/><bind nodeset="/data/q46" type="string"/><bind nodeset="/data/q47" type="string"/><bind nodeset="/data/q48" type="string"/><bind nodeset="/data/q49" type="string"/><bind nodeset="/data/q50" type="string"/><bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/></model></h:head>
<h:body><input ref="/data/q1"><label>Q1</label></input><input ref="/data/q2"><label>Q2</label></input><input ref="/data/q3"><label>Q3</label></input><input ref="/data/q4"><label>Q4</label></input><input ref="/data/q5"><label>Q5</label></input><input ref="/data/q6"><label>Q6</label></input><input ref="/data/q7"><label>Q7</label></input><input ref="/data/q8"><label>Q8</label></input><input ref="/data/q9"><label>Q9</label></input><input ref="/data/q10"><label>Q10</label></input><input ref="/data/q11"><label>Q11</label></input><input ref="/data/q12"><label>Q12</label></input><input ref="/data/q13"><label>Q13</label></input><input ref="/data/q14"><label>Q14</label></input><input ref="/data/q15"><label>Q15</label></input><input ref="/data/q16"><label>Q16</label></input><input ref="/data/q17"><label>Q17</label></input><input ref="/data/q18"><label>Q18</label></input><input ref="/data/q19"><label>Q19</label></input><input ref="/data/q20"><label>Q20</label></input><input ref="/data/q21"><label>Q21</label></input><group ref="/data/repeat"><label>Repeat</label><repeat nodeset="/data/repeat"><input ref="/data/repeat/q22"><label>Q22</label></input><input ref="/data/repeat/q23"><label>Q23</label></input><input ref="/data/repeat/q24"><label>Q24</label></input><input ref="/data/repeat/q25"><label>Q25</label></input><input ref="/data/repeat/q26"><label>Q26</label></input><input ref="/data/repeat/q27"><label>Q27</label></input><input ref="/data/repeat/q28"><label>Q28</label></input><input ref="/data/repeat/q29"><label>Q29</label></input><input ref="/data/repeat/q30"><label>Q30</label></input><input ref="/data/repeat/q31"><label>Q31</label></input><input ref="/data/repeat/q32"><label>Q32</label></input><input ref="/data/repeat/q33"><label>Q33</label></input><input ref="/data/repeat/q34"><label>Q34</label></input><input ref="/data/repeat/q35"><label>Q35</label></input><input ref="/data/repeat/q36"><label>Q36</label></input><input ref="/data/repeat/q37"><label>Q37</label></input><input ref="/data/repeat/q38"><label>Q38</label></input><input ref="/data/repeat/q39"><label>Q39</label></input><input ref="/data/repeat/q40"><label>Q40</label></input><input ref="/data/repeat/q41"><label>Q41</label></input></repeat></group><input ref="/data/q42"><label>Q42</label></input><input ref="/data/q43"><label>Q43</label></input><input ref="/data/q44"><label>Q44</label></input><input ref="/data/q45"><label>Q45</label></input><input ref="/data/q46"><label>Q46</label></input><input ref="/data/q47"><label>Q47</label></input><input ref="/data/q48"><label>Q48</label></input><input ref="/data/q49"><label>Q49</label></input><input ref="/data/q50"><label>Q50</label></input></h:body></h:html>`)
        .set('Content-Type', 'text/xml')
        .expect(200);
      for (let i = 0; i < 50; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await asAlice.post('/v1/projects/1/forms/single-repeat-1-instance-10qs/submissions')
          .send(`<data id="single-repeat-1-instance-10qs">
  <meta><instanceID>${uuid()}</instanceID></meta>
  ${[ 1, 2, 3, 4, 5, 6, 7, 8, 9 ].map((q) => `<q${q}>${uuid()}</q${q}>`).join('')}
  <repeat>${[ 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 ].map((q) => `<q${q}>${uuid()}</q${q}>`).join('')}</repeat>
  ${[ 42, 43, 44, 45, 46, 47, 48, 49, 50 ].map((q) => `<q${q}>${uuid()}</q${q}>`).join('')}
  </data>`)
          .set('Content-Type', 'text/xml')
          .expect(200);
      }
      const result = await httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/single-repeat-1-instance-10qs/submissions.csv.zip'));
      result.filenames.should.eql([ 'single-repeat-1-instance-10qs.csv', 'single-repeat-1-instance-10qs-repeat.csv' ]);
      result.files.get('single-repeat-1-instance-10qs.csv').split('\n').length.should.equal(52);
      result.files.get('single-repeat-1-instance-10qs-repeat.csv').split('\n').length.should.equal(52);
    }));

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
        .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
          .then((result) => {
            result.filenames.should.eql([ 'simple.csv' ]);
            const csv = result.files.get('simple.csv').split('\n').map((row) => row.split(','));
            csv.length.should.equal(4); // header + 2 data rows + newline
            csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
            csv[1].shift().should.be.an.recentIsoDate();
            // eslint-disable-next-line comma-spacing
            csv[1].should.eql([ 'two','Bob','34','two','5','Alice','0','0','','','','0','' ]);
            csv[2].shift().should.be.an.recentIsoDate();
            // eslint-disable-next-line comma-spacing
            csv[2].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0','' ]);
            csv[3].should.eql([ '' ]);
          })))));

    it('should not return data from deleted submissions in csv export', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.two)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.three)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simple/submissions/two');

      const result = await httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'));
      const csv = result.files.get('simple.csv').split('\n').map((row) => row.split(','));
      csv.length.should.equal(4); // header + 2 data rows + newline
      csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
      csv[1].shift().should.be.an.recentIsoDate();
      // eslint-disable-next-line comma-spacing
      csv[1].should.eql([ 'three','Chelsea','38','three','5','Alice','0','0','','','','0','' ]);
      csv[2].shift().should.be.an.recentIsoDate();
      // eslint-disable-next-line comma-spacing
      csv[2].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0','' ]);
      csv[3].should.eql([ '' ]);
    }));

    it('should return a submitter-filtered zipfile with the relevant data', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asBob.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.three)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip?$filter=__system/submitterId eq 5'))
              .then((result) => {
                result.filenames.should.eql([ 'simple.csv' ]);
                const lines = result.files.get('simple.csv').split('\n');
                lines.length.should.equal(4);
                lines[1].endsWith(',three,Chelsea,38,three,5,Alice,0,0,,,,0,').should.equal(true);
                lines[2].endsWith(',one,Alice,30,one,5,Alice,0,0,,,,0,').should.equal(true);
              }))))));

    it('should return a review state-filtered zipfile with the relevant data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/two')
            .send({ reviewState: 'approved' })
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.three)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip?$filter=__system/reviewState eq null'))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              const lines = result.files.get('simple.csv').split('\n');
              lines.length.should.equal(4);
              lines[1].endsWith(',three,Chelsea,38,three,5,Alice,0,0,,,,0,').should.equal(true);
              lines[2].endsWith(',one,Alice,30,one,5,Alice,0,0,,,,0,').should.equal(true);
            })))));

    it('should return a submissionDate-filtered zipfile with the relevant data', testService((service, { run }) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => run(sql`update submissions set "createdAt"='2010-06-01'`))
            .then(() => asBob.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip?$filter=year(__system/submissionDate) eq 2010'))
              .then((result) => {
                result.filenames.should.eql([ 'simple.csv' ]);
                const lines = result.files.get('simple.csv').split('\n');
                lines.length.should.equal(3);
                lines[1].endsWith(',one,Alice,30,one,5,Alice,0,0,,,,0,').should.equal(true);
              }))))));

    it('should return an updatedAt-filtered zipfile with the relevant data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/two')
            .send({ reviewState: 'approved' })
            .expect(200))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip?$filter=__system/updatedAt eq null'))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              const lines = result.files.get('simple.csv').split('\n');
              lines.length.should.equal(3);
              lines[1].endsWith(',one,Alice,30,one,5,Alice,0,0,,,,0,').should.equal(true);
            })))));

    it('should return a zipfile with the relevant attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([
                  'binaryType.csv',
                  'media/my_file1.mp4',
                  'media/here_is_file2.jpg'
                ]);

                result.files.get('media/my_file1.mp4').should.equal('this is test file one');
                result.files.get('media/here_is_file2.jpg').should.equal('this is test file two');

                // we also check the csv for the sake of verifying the attachments counts.
                const csv = result.files.get('binaryType.csv').split('\n');
                csv[0].should.equal('SubmissionDate,meta-instanceID,file1,file2,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
                csv[1].should.endWith(',both,my_file1.mp4,here_is_file2.jpg,both,5,Alice,2,2,,,,0,');
                csv.length.should.equal(3); // newline at end
              }))))));

    it('should return a zipfile with the relevant attachments if s3 is enabled', testService((service, { Blobs }) => {
      global.s3.enableMock();
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
            .then(() => Blobs.s3UploadPending())
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([
                  'binaryType.csv',
                  'media/my_file1.mp4',
                  'media/here_is_file2.jpg'
                ]);

                result.files.get('media/my_file1.mp4').should.equal('this is test file one');
                result.files.get('media/here_is_file2.jpg').should.equal('this is test file two');

                // we also check the csv for the sake of verifying the attachments counts.
                const csv = result.files.get('binaryType.csv').split('\n');
                csv[0].should.equal('SubmissionDate,meta-instanceID,file1,file2,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
                csv[1].should.endWith(',both,my_file1.mp4,here_is_file2.jpg,both,5,Alice,2,2,,,,0,');
                csv.length.should.equal(3); // newline at end
              }))));
    }));

    it('should handle s3 errors when trying to construct zipfile', testService((service, { Blobs }) => {
      global.s3.enableMock();
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
            .then(() => Blobs.s3UploadPending())
            .then(() => { global.s3.error.onDownload = true; })
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip')
              .then(() => should.fail('Should have thrown an error.'))
              .catch(err => err.message.should.equal('aborted')))));
    }));

    it('should filter attachments by the query', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.binaryType)
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.one), { filename: 'data.xml' })
              .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
              .expect(201)
              .then(() => asBob.post('/v1/projects/1/submission')
                .set('X-OpenRosa-Version', '1.0')
                .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.two), { filename: 'data.xml' })
                .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
                .expect(201))
              .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip?$filter=__system/submitterId eq 5'))
                .then((result) => {
                  result.filenames.should.eql([
                    'binaryType.csv',
                    'media/my_file1.mp4'
                  ]);
                })))))));

    it('should list the original submitted form version per submission', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .set('Content-Type', 'text/xml')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="updated"'))
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.simple.one
              .replace('id="simple"', 'id="simple" version="updated"')
              .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')),
            { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.three.replace('id="simple"', 'id="simple" version="updated"'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
            .then((result) => {
              result.filenames.should.eql([ 'simple.csv' ]);
              const lines = result.files.get('simple.csv').split('\n');
              lines[1].endsWith('0,updated').should.equal(true);
              lines[2].endsWith('0,').should.equal(true);
              lines[3].endsWith('1,').should.equal(true);
            })))));

    it('should split select multiple values if ?splitSelectMultiples=true', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.selectMultiple)
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.one))
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.two))
          .then(() => exhaust(container))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/selectMultiple/submissions.csv.zip?splitSelectMultiples=true'))
            .then((result) => {
              result.filenames.should.containDeep([ 'selectMultiple.csv' ]);
              const lines = result.files.get('selectMultiple.csv').split('\n');
              lines[0].should.equal('SubmissionDate,meta-instanceID,q1,q1/a,q1/b,g1-q2,g1-q2/m,g1-q2/x,g1-q2/y,g1-q2/z,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
              lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',two,b,0,1,m x,1,1,0,0,two,5,Alice,0,0,,,,0,');
              lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',one,a b,1,1,x y z,0,1,1,1,one,5,Alice,0,0,,,,0,');
            })))));

    it('should omit multiples it does not know about', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.selectMultiple)
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.one))
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.two))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/selectMultiple/submissions.csv.zip?splitSelectMultiples=true'))
            .then((result) => {
              result.filenames.should.containDeep([ 'selectMultiple.csv' ]);
              const lines = result.files.get('selectMultiple.csv').split('\n');
              lines[0].should.equal('SubmissionDate,meta-instanceID,q1,g1-q2,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
              lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',two,b,m x,two,5,Alice,0,0,,,,0,');
              lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',one,a b,x y z,one,5,Alice,0,0,,,,0,');
            })))));

    it('should split select multiples and filter given both options', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.selectMultiple)
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.one))
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.two))
          .then(() => asAlice.patch('/v1/projects/1/forms/selectMultiple/submissions/two')
            .send({ reviewState: 'approved' }))
          .then(() => exhaust(container))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/selectMultiple/submissions.csv.zip?splitSelectMultiples=true&$filter=__system/reviewState eq null'))
            .then((result) => {
              const lines = result.files.get('selectMultiple.csv').split('\n');
              lines.length.should.equal(3);
              lines[1].should.containEql(',one,');
              lines[1].should.not.containEql('two');
              lines[2].should.equal('');
            })))));

    it('should export deleted fields and values if ?deletedFields=true', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .set('Content-Type', 'application/xml')
          .send(testData.instances.simple.one)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.simple.two))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
            .set('Content-Type', 'application/xml')
            .send(`
              <?xml version="1.0"?>
              <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
                <h:head>
                  <model>
                    <instance>
                      <data id="simple" version="2">
                        <meta><instanceID/></meta>
                        <name/>
                      </data>
                    </instance>
                    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
                    <bind nodeset="/data/name" type="string"/>
                  </model>
                </h:head>
              </h:html>`)
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish').expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.simple.three.replace('id="simple"', 'id="simple" version="2"')))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip?deletedFields=true'))
            .then((result) => {
              result.filenames.should.containDeep([ 'simple.csv' ]);
              const lines = result.files.get('simple.csv').split('\n');
              lines[0].should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
              lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',three,Chelsea,38,three,5,Alice,0,0,,,,0,2');
              lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',two,Bob,34,two,5,Alice,0,0,,,,0,');
              lines[3].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',one,Alice,30,one,5,Alice,0,0,,,,0,');
            })))));

    it('should skip attachments if ?attachments=false is given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip?attachments=false'))
              .then((result) => {
                result.filenames.should.containDeep([ 'binaryType.csv' ]);

                should.not.exist(result.files.get('media/my_file1.mp4'));
                should.not.exist(result.files.get('media/here_is_file2.jpg'));

              }))))));

    it('should give the appropriate filename if ?attachments=false is given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip?attachments=false')
            .expect(200)
            .then(({ headers }) => {
              headers['content-disposition'].should.equal('attachment; filename="binaryType.csv.zip"; filename*=UTF-8\'\'binaryType.csv.zip');
            })))));

    it('should omit group paths if ?groupPaths=false is given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip?groupPaths=false'))
            .then((result) => {
              const csv = result.files.get('simple.csv').split('\n');
              csv[0].should.equal('SubmissionDate,instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
            })))));

    it('should split select AND omit group paths given both options', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.selectMultiple)
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.one))
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.two))
          .then(() => exhaust(container))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/selectMultiple/submissions.csv.zip?splitSelectMultiples=true&groupPaths=false'))
            .then((result) => {
              result.filenames.should.containDeep([ 'selectMultiple.csv' ]);
              const lines = result.files.get('selectMultiple.csv').split('\n');
              lines[0].should.equal('SubmissionDate,instanceID,q1,q1/a,q1/b,q2,q2/m,q2/x,q2/y,q2/z,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
              lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',two,b,0,1,m x,1,1,0,0,two,5,Alice,0,0,,,,0,');
              lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',one,a b,1,1,x y z,0,1,1,1,one,5,Alice,0,0,,,,0,');
            })))));

    it('should properly count present attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .expect(201)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/binaryType/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([
                  'binaryType.csv',
                  'media/my_file1.mp4'
                ]);

                // we also check the csv for the sake of verifying the attachments counts.
                const csv = result.files.get('binaryType.csv').split('\n');
                csv[0].should.equal('SubmissionDate,meta-instanceID,file1,file2,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
                csv[1].should.endWith(',both,my_file1.mp4,here_is_file2.jpg,both,5,Alice,1,2,,,,0,');
                csv.length.should.equal(3); // newline at end

              }))))));

    it('should return worker-processed consolidated client audit log attachments', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
            .then((result) => {
              result.filenames.should.eql([
                'audits.csv',
                'audits - audit.csv'
              ]);

              result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb,,
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd,,
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff,,
one,d,/data/d,2000-01-01T00:10,,10,11,12,gg,,,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii,,
two,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,,
two,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,,
two,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,
`);
            }))
          .then(() => container.oneFirst(sql`select count(*) from client_audits`)
            .then((count) => { count.should.equal(8); })))));

    it('should return adhoc-processed consolidated client audit log attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
            .then((result) => {
              result.filenames.should.eql([
                'audits.csv',
                'audits - audit.csv'
              ]);

              result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb,,
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd,,
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff,,
one,d,/data/d,2000-01-01T00:10,,10,11,12,gg,,,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii,,
two,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,,
two,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,,
two,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,
`);
            })))));

    it('should return adhoc-processed consolidated client audit log attachments if uploaded to s3', testService((service, { Blobs }) => {
      global.s3.enableMock();
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then(() => Blobs.s3UploadPending())
          .then(() => {
            global.s3.uploads.attempted.should.equal(2);
            global.s3.uploads.successful.should.equal(2);
          })
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
            .then((result) => {
              result.filenames.should.eql([
                'audits.csv',
                'audits - audit.csv'
              ]);

              result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb,,
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd,,
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff,,
one,d,/data/d,2000-01-01T00:10,,10,11,12,gg,,,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii,,
two,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,,
two,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,,
two,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,
`);
            }))
          .then(() => {
            global.s3.downloads.attempted.should.equal(2);
            global.s3.downloads.successful.should.equal(2);
          }));
    }));

    it('should gracefully handle error if client audit s3 download fails', testService((service, { Blobs }) => {
      global.s3.enableMock();
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then(() => Blobs.s3UploadPending())
          .then(() => { global.s3.error.onDownload = true; })
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip')
            .then(() => should.fail('should have thrown'))
            .catch(err => err.message.should.equal('aborted'))));
    }));

    it('should return additional user and change-reason columns of client audit log', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.clientAudits)
        .expect(200);

      // The client audit for this submission contains user and change-reason columns
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('audit.csv', createReadStream(appRoot + '/test/data/audit4.csv'), { filename: 'audit.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
        .expect(201);

      // The client audit for this submission does not contain user and change-reason columns
      await asAlice.post('/v1/projects/1/submission')
        .set('X-OpenRosa-Version', '1.0')
        .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
        .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
        .expect(201);

      const expected = `instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,l,/data/l,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,user,reason1
one,m,/data/m,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,user,
one,n,/data/n,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,reason2
two,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,,
two,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,,
two,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,
`;

      // Constructed ad-hoc
      await httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
        .then((res) => res.files.get('audits - audit.csv').should.equal(expected));

      // Run worker to process client audits
      await exhaust(container);

      // Constructed from worker-processed client audit log
      await httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
        .then((res) => res.files.get('audits - audit.csv').should.equal(expected));
    }));

    it('should return consolidated client audit log filtered by user', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.clientAudits)
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
              .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
              .expect(201))
            .then(() => asBob.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
              .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
              .expect(201))
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip?$filter=__system/submitterId eq 5'))
              .then((result) => {
                result.filenames.should.eql([
                  'audits.csv',
                  'audits - audit.csv'
                ]);

                result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb,,
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd,,
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff,,
one,d,/data/d,2000-01-01T00:10,,10,11,12,gg,,,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii,,
`);

              }))))));

    it('should return consolidated client audit log filtered by review state', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appRoot + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.patch('/v1/projects/1/forms/audits/submissions/one')
            .send({ reviewState: 'approved' })
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('log.csv', createReadStream(appRoot + '/test/data/audit2.csv'), { filename: 'log.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.two), { filename: 'data.xml' })
            .expect(201))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip?$filter=__system/reviewState eq \'approved\''))
            .then((result) => {
              result.filenames.should.eql([
                'audits.csv',
                'audits - audit.csv'
              ]);

              result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb,,
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd,,
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff,,
one,d,/data/d,2000-01-01T00:10,,10,11,12,gg,,,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii,,
`);

            })))));

    it('should return the latest attached audit log after openrosa replace', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.eql([
                  'audits.csv',
                  'audits - audit.csv'
                ]);

                result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,,
one,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,,
one,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,
`);

              }))))));

    it('should return the latest attached audit log after REST replace', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.eql([
                  'audits.csv',
                  'audits - audit.csv'
                ]);

                result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,,
one,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,,
one,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,
`);

              }))))));

    it('should tolerate differences in line lengths', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', Buffer.from(readFileSync(appRoot + '/test/data/audit.csv').toString('utf8').replace('gg,', ''), 'utf8'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip')
            .expect(200)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.eql([
                  'audits.csv',
                  'audits - audit.csv'
                ]);

                result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb,,
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd,,
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff,,
one,d,/data/d,2000-01-01T00:10,,10,11,12,,,,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii,,
`);
              }))))));

    it('should tolerate quote inside unquoted field of client audit log', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', Buffer.from(readFileSync(appRoot + '/test/data/audit.csv').toString('utf8').replace('gg', 'g"g'), 'utf8'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip')
            .expect(200)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.eql([
                  'audits.csv',
                  'audits - audit.csv'
                ]);

                result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,a,/data/a,2000-01-01T00:01,2000-01-01T00:02,1,2,3,aa,bb,,
one,b,/data/b,2000-01-01T00:02,2000-01-01T00:03,4,5,6,cc,dd,,
one,c,/data/c,2000-01-01T00:03,2000-01-01T00:04,7,8,9,ee,ff,,
one,d,/data/d,2000-01-01T00:10,,10,11,12,"g""g",,,
one,e,/data/e,2000-01-01T00:11,,,,,hh,ii,,
`);
              }))))));

    context('versioning', () => {
      const withClientAuditIds = (deprecatedId, instanceId) => testData.instances.clientAudits.one
        .replace('one</instance', `${instanceId}</instanceID><deprecatedID>${deprecatedId}</deprecated`);

      it('should return original instanceId and latest attached audit log when instanceId deprecated with new audit log', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
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
              .attach('xml_submission_file', Buffer.from(withClientAuditIds('one', 'two')), { filename: 'data.xml' })
              .expect(201))
            .then(() => asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip')
              .expect(200)
              .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/audits/submissions.csv.zip'))
                .then((result) => {
                  result.filenames.should.eql([
                    'audits.csv',
                    'audits - audit.csv'
                  ]);

                  result.files.get('audits - audit.csv').should.equal(`instance ID,event,node,start,end,latitude,longitude,accuracy,old-value,new-value,user,change-reason
one,f,/data/f,2000-01-01T00:04,2000-01-01T00:05,-1,-2,,aa,bb,,
one,g,/data/g,2000-01-01T00:05,2000-01-01T00:06,-3,-4,,cc,dd,,
one,h,/data/h,2000-01-01T00:06,2000-01-01T00:07,-5,-6,,ee,ff,,
`);
                }))))));
    });

    it('should log the action in the audit log', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip')
          .expect(200)
          .then(() => asAlice.get('/v1/audits?action=form.submission.export')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
              body[0].actee.xmlFormId.should.equal('simple');
              should.not.exist(body[0].details);
            })))));
  });

  describe('.csv GET', () => {
    // NOTE: tests related to decryption of .csv.zip export are located in test/integration/other/encryption.js

    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nope/submissions.csv')
          .expect(404))));

    it('should reject if the user cannot get submissions', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple/submissions.csv')
          .expect(403))));

    it('should return a csv with the relevant headers', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions.csv')
          .expect(200)
          .then(({ headers }) => {
            headers['content-disposition'].should.equal('attachment; filename="simple.csv"; filename*=UTF-8\'\'simple.csv');
            headers['content-type'].should.equal('text/csv; charset=utf-8');
          }))));

    it('should return the root csv table', testService((service) =>
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
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions.csv')
            .expect(200)
            .then(({ text }) => { text.should.be.a.SimpleCsv(); })))));

    it('should return only the root csv table given repeats', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.three)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/withrepeat/submissions.csv')
            .expect(200)
            .then(({ text }) => {
              const rows = text.split('\n');
              rows.length.should.equal(5);
              rows[0].should.equal('SubmissionDate,meta-instanceID,name,age,children-child-name,children-child-age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
              // (need to drop the iso date)
              rows[1].slice(24).should.equal(',rthree,Chelsea,38,,,rthree,5,Alice,0,0,,,,0,1.0');
              rows[2].slice(24).should.equal(',rtwo,Bob,34,,,rtwo,5,Alice,0,0,,,,0,1.0');
              rows[3].slice(24).should.equal(',rone,Alice,30,,,rone,5,Alice,0,0,,,,0,1.0');
            })))));

    it('should split select multiple values if ?splitSelectMultiples=true', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.selectMultiple)
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.one))
          .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.selectMultiple.two))
          .then(() => exhaust(container))
          .then(() => asAlice.get('/v1/projects/1/forms/selectMultiple/submissions.csv?splitSelectMultiples=true')
            .expect(200)
            // eslint-disable-next-line no-multi-spaces
            .then(({ text }) =>  {
              const lines = text.split('\n');
              lines[0].should.equal('SubmissionDate,meta-instanceID,q1,q1/a,q1/b,g1-q2,g1-q2/m,g1-q2/x,g1-q2/y,g1-q2/z,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
              lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',two,b,0,1,m x,1,1,0,0,two,5,Alice,0,0,,,,0,');
              lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',one,a b,1,1,x y z,0,1,1,1,one,5,Alice,0,0,,,,0,');
            })))));

    it('should omit group paths if ?groupPaths=false is given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions.csv?groupPaths=false')
          .expect(200)
          .then(({ text }) => {
            const lines = text.split('\n');
            lines[0].should.equal('SubmissionDate,instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
          }))));

    it('should log the action in the audit log', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions.csv')
          .expect(200)
          .then(() => asAlice.get('/v1/audits?action=form.submission.export')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actorId.should.equal(5);
              body[0].actee.xmlFormId.should.equal('simple');
              should.not.exist(body[0].details);
            })))));

    describe('different versions of form schema', () => {
      it('should export deleted fields and values if ?deletedFields=true', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/submissions')
            .set('Content-Type', 'application/xml')
            .send(testData.instances.simple.one)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .set('Content-Type', 'application/xml')
              .send(testData.instances.simple.two))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
              .set('Content-Type', 'application/xml')
              .send(`
                <?xml version="1.0"?>
                <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
                  <h:head>
                    <model>
                      <instance>
                        <data id="simple" version="2">
                          <meta><instanceID/></meta>
                          <name/>
                        </data>
                      </instance>
                      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
                      <bind nodeset="/data/name" type="string"/>
                    </model>
                  </h:head>
                </h:html>`)
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish').expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft').expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=3').expect(200)) // introduce a new version with same schema as before
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .set('Content-Type', 'application/xml')
              .send(testData.instances.simple.three.replace('id="simple"', 'id="simple" version="3"')))
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip?deletedFields=true'))
              .then((result) => {
                result.filenames.should.containDeep([ 'simple.csv' ]);
                const lines = result.files.get('simple.csv').split('\n');
                lines[0].should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
                lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                  .should.equal(',three,Chelsea,38,three,5,Alice,0,0,,,,0,3');
                lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                  .should.equal(',two,Bob,34,two,5,Alice,0,0,,,,0,');
                lines[3].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                  .should.equal(',one,Alice,30,one,5,Alice,0,0,,,,0,');
              })))));

      it('should split select multiple values if ?splitSelectMultiples=true', testService((service, container) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.selectMultiple)
            .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/draft').expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/draft/publish?version=2').expect(200)) // introduce a new version with same schema as before
            .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/draft?ignoreWarnings=true')
              .set('Content-Type', 'application/xml')
              .send(`
                <?xml version="1.0"?>
                <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
                  <h:head>
                    <model>
                      <instance>
                        <data id="selectMultiple" version='3'>
                          <meta><instanceID/></meta>
                          <q1/>
                          <g1><q2/></g1>
                          <q3/>
                        </data>
                      </instance>
                      <bind nodeset="/data/meta/instanceID" type="string"/>
                      <bind nodeset="/data/q1" type="string"/>
                      <bind nodeset="/data/g1/q2" type="string"/>
                      <bind nodeset="/data/q3" type="string"/>
                    </model>
                  </h:head>
                  <h:body>
                    <select ref="/data/q1"><label>one</label></select>
                    <group ref="/data/g1">
                      <label>group</label>
                      <select ref="/data/g1/q2"><label>two</label></select>
                    </group>
                    <select ref="/data/q3"><label>three</label></select>
                  </h:body>
                </h:html>`)
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/draft/publish').expect(200)) // new different schema
            .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
              .set('Content-Type', 'application/xml')
              .send(testData.instances.selectMultiple.one))
            .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
              .set('Content-Type', 'application/xml')
              .send(testData.instances.selectMultiple.two))
            .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
              .set('Content-Type', 'application/xml')
              .send(`
                <data id="selectMultiple" version="3">
                  <orx:meta><orx:instanceID>three</orx:instanceID></orx:meta>
                  <q1>a b</q1>
                  <g1>
                    <q2>m</q2>
                  </g1>
                  <q3>z</q3>
                </data>
              `).expect(200))
            .then(() => exhaust(container))
            .then(() => asAlice.get('/v1/projects/1/forms/selectMultiple/submissions.csv?splitSelectMultiples=true')
              .expect(200)
              .then(({ text }) => {
                const lines = text.split('\n');
                lines[0].should.equal('SubmissionDate,meta-instanceID,q1,q1/a,q1/b,g1-q2,g1-q2/m,g1-q2/x,g1-q2/y,g1-q2/z,q3,q3/z,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
                lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                  .should.equal(',three,a b,1,1,m,1,0,0,0,z,1,three,5,Alice,0,0,,,,0,3');
                lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                  .should.equal(',two,b,0,1,m x,1,1,0,0,,0,two,5,Alice,0,0,,,,0,');
                lines[3].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                  .should.equal(',one,a b,1,1,x y z,0,1,1,1,,0,one,5,Alice,0,0,,,,0,');
              })))));
    });
  });

  describe('[draft] .csv.zip', () => {
    it('should return notfound if there is no draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/draft/submissions.csv.zip')
          .expect(404))));

    it('should return draft submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions.csv.zip')
            .expect(200)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/draft/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([ 'simple.csv' ]);

                const csv = result.files.get('simple.csv').split('\n').map((row) => row.split(','));
                csv.length.should.equal(3); // header + data row + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                // eslint-disable-next-line comma-spacing
                csv[1].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0','' ]);
              }))))));

    it('should not include draft submissions in nondraft csvzip', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions.csv.zip')
            .expect(200)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([ 'simple.csv' ]);

                result.files.get('simple.csv').should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion\n');
              }))))));

    it('should not carry draft submissions forward to the published version upon publish', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip')
            .expect(200)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([ 'simple.csv' ]);

                result.files.get('simple.csv').should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion\n');
              }))))));

    it('should not carry over drafts when a draft is replaced', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions.csv.zip')
            .expect(200)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([ 'simple.csv' ]);

                result.files.get('simple.csv').should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion\n');
              }))))));

    it('should not resurface drafts when a draft is recreated', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions.csv.zip')
            .expect(200)
            .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/simple/submissions.csv.zip'))
              .then((result) => {
                result.filenames.should.containDeep([ 'simple.csv' ]);

                result.files.get('simple.csv').should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion\n');
              }))))));

    it('should not log the action in the audit log', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions.csv.zip')
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=form.submission.export')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(0);
            })))));

    it('should split select multiple values submitted over /test/ if ?splitSelectMultiples=true', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.selectMultiple)
          .then(() => asAlice.get('/v1/projects/1/forms/selectMultiple/draft')
            .expect(200)
            .then(({ body }) => body.draftToken)
            .then((token) => service.post(`/v1/test/${token}/projects/1/forms/selectMultiple/draft/submission`)
              .set('Content-Type', 'application/xml')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.selectMultiple.one), { filename: 'data.xml' })
              .then(() => service.post(`/v1/test/${token}/projects/1/forms/selectMultiple/draft/submission`)
                .set('Content-Type', 'application/xml')
                .set('X-OpenRosa-Version', '1.0')
                .attach('xml_submission_file', Buffer.from(testData.instances.selectMultiple.two), { filename: 'data.xml' }))))
          .then(() => exhaust(container))
          .then(() => httpZipResponseToFiles(asAlice.get('/v1/projects/1/forms/selectMultiple/draft/submissions.csv.zip?splitSelectMultiples=true'))
            .then((result) => {
              result.filenames.should.containDeep([ 'selectMultiple.csv' ]);
              const lines = result.files.get('selectMultiple.csv').split('\n');
              lines[0].should.equal('SubmissionDate,meta-instanceID,q1,q1/a,q1/b,g1-q2,g1-q2/m,g1-q2/x,g1-q2/y,g1-q2/z,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
              lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',two,b,0,1,m x,1,1,0,0,two,,,0,0,,,,0,');
              lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
                .should.equal(',one,a b,1,1,x y z,0,1,1,1,one,,,0,0,,,,0,');
            })))));
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

  describe('[draft] GET', () => {
    it('should return notfound if the draft does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/draft/submissions').expect(404))));

    it('should return a list of submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
            .expect(200)
            .then(({ body }) => {
              body.forEach((submission) => submission.should.be.a.Submission());
              body.map((submission) => submission.instanceId).should.eql([ 'two', 'one' ]);
            })))));

    it('should not include draft submissions non-draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));

    it('should not carry draft submissions forward to the published version upon publish', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));

    it('should not carry over drafts when a draft is replaced', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));

    it('should not resurface drafts when a draft is recreated', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should return multiple self-managed keys if they are used', testService((service, { Forms }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => Promise.all([
            Forms.getByProjectAndXmlFormId(1, 'encrypted', Form.DraftVersion).then((o) => o.get()),
            Form.fromXml(testData.forms.encrypted
              .replace(/PublicKey="[a-z0-9+/]+"/i, 'PublicKey="keytwo"')
              .replace('working3', 'working4'))
          ]))
          .then(([ form, partial ]) => Forms.createVersion(partial, form, true))
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

    it('should not return unused keys', testService((service, { Forms }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => Promise.all([
            Forms.getByProjectAndXmlFormId(1, 'encrypted', Form.DraftVersion).then((o) => o.get()),
            Form.fromXml(testData.forms.encrypted
              .replace(/PublicKey="[a-z0-9+/]+"/i, 'PublicKey="keytwo"')
              .replace('working3', 'working4'))
          ]))
          .then(([ form, partial ]) => Forms.createVersion(partial, form, false))
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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

  describe('/submitters GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent/submissions/submitters').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple/submissions/submitters').expect(403))));

    it('should return an empty array if there are no submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/submitters')
          .expect(200)
          .then(({ body }) => { body.should.eql([]); }))));

    it('should return all submitters once', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms/simple/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asBob.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.three)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/submitters')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(2);
                body[0].displayName.should.equal('Alice');
                body[1].displayName.should.equal('Bob');
              }))))));
  });

  describe('[draft] /keys GET', () => {
    it('should return notfound if the draft does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/draft/keys').expect(404))));

    it('should return draft-used keys', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/draft/submissions/keys')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.a.Key();
              body[0].public.should.equal('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyYh7bSui/0xppQ+J3i5xghfao+559Rqg9X0xNbdMEsW35CzYUfmC8sOzeeUiE4pG7HIEUmiJal+mo70UMDUlywXj9z053n0g6MmtLlUyBw0ZGhEZWHsfBxPQixdzY/c5i7sh0dFzWVBZ7UrqBc2qjRFUYxeXqHsAxSPClTH1nW47Mr2h4juBLC7tBNZA3biZA/XTPt//hAuzv1d6MGiF3vQJXvFTNdfsh6Ckq4KXUsAv+07cLtON4KjrKhqsVNNGbFssTUHVL4A9N3gsuRGt329LHOKBxQUGEnhMM2MEtvk4kaVQrgCqpk1pMU/4HlFtRjOoKdAIuzzxIl56gNdRUQIDAQAB');
            })))));

    it('should not include draft keys nondraft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/submissions/keys')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));

    it('should not carry draft keys forward to the published version upon publish', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/submissions/keys')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));

    it('should not carry over draft keys when a draft is replaced', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/draft/submissions/keys')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));

    it('should not resurface draft keys when a draft is recreated', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted/draft/submissions/keys')
            .expect(200)
            .then(({ body }) => { body.should.eql([]); })))));
  });

  describe('/:instanceId/audits GET', () => {
    it('should return notfound if the instance does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/one/audits')
          .expect(404))));

    it('should reject if the user cannot read audits', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/audits')
              .expect(403))))));

    it('should return all audit logs on the submission', testService((service, { oneFirst, all }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
            .send({ reviewState: 'rejected' })
            .expect(200))
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .send(withSimpleIds('one', 'two'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.delete('/v1/projects/1/forms/simple/submissions/one')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/restore')
            .expect(200))
          .then(() => oneFirst(sql`select id from submissions`))
          .then((submissionId) => all(sql`SELECT id FROM submission_defs WHERE "submissionId" = ${submissionId} ORDER BY id desc`)
            .then(map(o => o.id))
            .then(submissionDefIds => asAlice.get('/v1/projects/1/forms/simple/submissions/one/audits')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(5);
                for (const audit of body) audit.should.be.an.Audit();
                body[0].action.should.equal('submission.restore');
                body[0].details.should.eql({ submissionId, instanceId: 'one' });

                body[1].action.should.equal('submission.delete');
                body[1].details.should.eql({ submissionId, instanceId: 'one' });

                body[2].action.should.equal('submission.update.version');
                body[2].details.should.eql({ instanceId: 'two', submissionId, submissionDefId: submissionDefIds[0] });

                body[3].action.should.equal('submission.update');
                body[3].details.reviewState.should.equal('rejected');
                body[3].details.submissionId.should.equal(submissionId);
                should.exist(body[3].details.submissionDefId);

                body[4].action.should.equal('submission.create');
                body[4].details.should.eql({ instanceId: 'one', submissionId, submissionDefId: submissionDefIds[1] });
              }))))));

    it('should not expand actor when not extended', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
            .send({ reviewState: 'rejected' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/audits')
            .expect(200)
            .then(({ body }) => {
              should.not.exist(body[0].actor);
              body[0].actorId.should.equal(5);
            })))));

    it('should expand actor on extended', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
            .send({ reviewState: 'rejected' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/audits')
            .set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              body[0].actor.should.be.an.Actor();
              body[0].actor.displayName.should.equal('Alice');
            })))));

    describe('submission audits about entity events', () => {
      it('should return full entity in details of an event about an entity', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body }) => {
            const entityCreate = body[0];
            entityCreate.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
            entityCreate.details.entity.should.be.an.Entity();
            entityCreate.details.entity.currentVersion.should.be.an.EntityDef();
          });
      }));

      it('should not return basic entity details when extended metadata not set', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body }) => {
            const entityCreate = body[0];
            entityCreate.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
            entityCreate.details.entity.dataset.should.equal('people');
            entityCreate.details.entity.should.not.have.property('currentVersion');
          });
      }));

      it('should return updated entity in currentVersion', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({ label: 'New Label' })
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body }) => {
            const entityCreate = body[0];
            entityCreate.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
            entityCreate.details.entity.currentVersion.label.should.equal('New Label');
          });
      }));

      it('should return entity uuid and dataset only when entity is soft-deleted', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc');

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body }) => {
            const entityCreate = body[0];
            entityCreate.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
            entityCreate.details.entity.dataset.should.equal('people');
            entityCreate.details.entity.should.not.have.property('currentVersion');
            entityCreate.details.entity.should.not.be.an.Entity();
          });
      }));

      it('should return entity uuid and dataset when entity is (manually) purged', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // cascade on delete isn't set up for entitites so let's ruthlessly delete all the entities
        await container.run(sql`delete from entity_defs`);
        await container.run(sql`delete from entities`);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .set('X-Extended-Metadata', true)
          .expect(200)
          .then(({ body }) => {
            const entityCreate = body[0];
            entityCreate.details.entity.uuid.should.equal('12345678-1234-4123-8234-123456789abc');
            entityCreate.details.entity.dataset.should.equal('people');
            entityCreate.details.entity.should.not.be.an.Entity();
          });
      }));
    });
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

    it('should redirect to the version if the referenced instanceID is out of date', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('two', 'three')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/two.xml')
            .expect(301)
            .then(({ text }) => {
              text.should.equal('Moved Permanently. Redirecting to /v1/projects/1/forms/simple/submissions/one/versions/two.xml');
            })))));
  });

  describe('[version] /:instanceId.xml GET', () => {
    it('should return notfound if the version does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/three.xml').expect(404)))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/versions/one.xml').expect(403))))));

    it('should return submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .send(withSimpleIds('one', 'two'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/one.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(testData.instances.simple.one); }),
            asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/two.xml')
              .expect(200)
              .then(({ text }) => { text.should.equal(withSimpleIds('one', 'two')); })
          ])))));
  });

  describe('[draft] /:instanceId.xml GET', () => {
    it('should return draft submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
            .expect(200)
            .then(({ header, text }) => {
              header['content-type'].should.equal('application/xml; charset=utf-8');
              text.should.equal(testData.instances.simple.one);
            })))));

    it('should not return draft submissions nondraft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
            .expect(404)))));

    it('should not carry draft submissions forward to the published version upon publish', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one.xml')
            .expect(404)))));

    it('should not carry over draft submissions when a draft is replaced', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
            .expect(404)))));

    it('should not resurface draft submissions when a draft is recreated', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
            .expect(404)))));
  });

  describe('/:instanceId GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent/submissions/one')
          .expect(404)
          .then(({ body }) => {
            should.not.exist(body.details);
          }))));

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

    // cb#858
    it('should not mince object properties', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asBob.put('/v1/projects/1/forms/simple/submissions/one')
        .set('Content-Type', 'text/xml')
        .send(withSimpleIds('one', 'two'))
        .expect(200);

      await container.run(sql`UPDATE actors SET "createdAt" = '2020-01-01T00:00:00Z' WHERE "displayName" = 'Alice'`);
      await container.run(sql`UPDATE actors SET "createdAt" = '2021-01-01T00:00:00Z' WHERE "displayName" = 'Bob'`);

      await container.run(sql`UPDATE submissions SET "createdAt" = '2022-01-01T00:00:00Z', "updatedAt" = '2023-01-01T00:00:00Z'`);

      await container.run(sql`UPDATE submission_defs SET "createdAt" = '2022-01-01T00:00:00Z' WHERE "instanceId" = 'one'`);
      await container.run(sql`UPDATE submission_defs SET "createdAt" = '2023-01-01T00:00:00Z' WHERE "instanceId" = 'two'`);

      await asAlice.get('/v1/projects/1/forms/simple/submissions/one')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.should.be.an.ExtendedSubmission();

          body.createdAt.should.match(/2022/);
          body.updatedAt.should.match(/2023/);

          body.submitter.displayName.should.equal('Alice');
          body.submitter.createdAt.should.match(/2020/);

          body.currentVersion.createdAt.should.match(/2023/);

          body.currentVersion.submitter.displayName.should.equal('Bob');
          body.currentVersion.submitter.createdAt.should.match(/2021/);
        });
    }));

    it('should redirect to the version if the referenced instanceID is out of date', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('two', 'three')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/two')
            .expect(301)
            .then(({ text }) => {
              text.should.equal('Moved Permanently. Redirecting to /v1/projects/1/forms/simple/submissions/one/versions/two');
            })))));
  });

  describe('[version] /:instanceId GET', () => {
    it('should return notfound if the root does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/one').expect(404))));

    it('should return notfound if the version does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/three').expect(404)))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/versions/one').expect(403))))));

    it('should return submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one.replace(/<\/meta>/, '<orx:instanceName>custom name</orx:instanceName></orx:meta>'))
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .set('Content-Type', 'text/xml')
            .send(withSimpleIds('one', 'two'))
            .expect(200))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/one')
              .expect(200)
              .then(({ body }) => {
                body.should.be.a.SubmissionDef();
                body.submitterId.should.equal(5);
                body.instanceId.should.equal('one');
                body.instanceName.should.equal('custom name');
              }),
            asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/two')
              .expect(200)
              .then(({ body }) => {
                body.should.be.a.SubmissionDef();
                body.submitterId.should.equal(5);
                body.instanceId.should.equal('two');
                should(body.instanceName).equal(null);
              })
          ])))));

    it('should return extended submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/one')
            .set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              body.should.be.an.ExtendedSubmissionDef();
              body.submitter.displayName.should.equal('Alice');
            })))));
  });

  describe('[draft] /:instanceId GET', () => {
    it('should return submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
              .expect(200)
              .then(({ body }) => {
                body.should.be.a.Submission();
                body.createdAt.should.be.a.recentIsoDate();
              }))))));

    it('should not return draft submissions nondraft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
              .expect(404))))));

    it('should not carry draft submissions forward to the published version upon publish', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one')
            .expect(404)))));

    it('should not carry over draft submissions when a draft is replaced', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
            .expect(404)))));

    it('should not resurface draft submissions when a draft is recreated', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
            .expect(404)))));
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

    it('should redirect to the version if the referenced instanceID is out of date', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('two', 'three')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/two/attachments')
            .expect(301)
            .then(({ text }) => {
              text.should.equal('Moved Permanently. Redirecting to /v1/projects/1/forms/simple/submissions/one/versions/two/attachments');
            })))));
  });

  describe('[version] /:rootId/versions/instanceId/attachments GET', () => {
    it('should return notfound if the version does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/three/attachments').expect(404)))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/versions/one/attachments').expect(403))))));

    it('should return attachment information', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .attach('xml_submission_file', Buffer.from(withBinaryIds('both', 'both2')), { filename: 'data.xml' })
            .expect(201))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/versions/both/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'here_is_file2.jpg', exists: true },
                  { name: 'my_file1.mp4', exists: false }
                ]);
              }),
            asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/versions/both2/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'here_is_file2.jpg', exists: true },
                  { name: 'my_file1.mp4', exists: true }
                ]);
              })
          ])))));
  });

  describe('[version] /:rootId/diffs GET', () => {
    it('should return notfound if the root does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/one/diffs').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/diffs').expect(403))))));

    it('should return diffs between different submission versions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            // eslint-disable-next-line comma-spacing
            .send(withSimpleIds('one', 'two').replace('<name>Alice</name>','<name>Angela</name>'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/diffs')
            .expect(200)
            .then(({ body }) => {
              const expected = {
                two: [
                  {
                    new: 'two',
                    old: 'one',
                    path: [ 'meta', 'instanceID' ]
                  },
                  {
                    new: 'one',
                    path: [ 'meta', 'deprecatedID' ]
                  },
                  {
                    new: 'Angela',
                    old: 'Alice',
                    path: [ 'name' ]
                  }
                ]
              };
              body.should.eql(expected);
            })))));
  });

  describe('[draft] /:instanceId/attachments GET', () => {
    it('should return draft attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'here_is_file2.jpg', exists: false },
                  { name: 'my_file1.mp4', exists: false }
                ]);
              }))))));

    it('should not return draft attachments nondraft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
              .expect(404))))));
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

    it('should redirect to the version if the referenced instanceID is out of date', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/submission')
          .set('X-OpenRosa-Version', '1.0')
          .attach('xml_submission_file', Buffer.from(testData.instances.simple.one), { filename: 'data.xml' })
          .expect(201)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('one', 'two')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(withSimpleIds('two', 'three')), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/two/attachments/anything.mp3')
            .expect(301)
            .then(({ text }) => {
              text.should.equal('Moved Permanently. Redirecting to /v1/projects/1/forms/simple/submissions/one/versions/two/attachments/anything.mp3');
            })))));
  });

  describe('[version] /:rootId/versions/instanceId/attachments GET', () => {
    it('should return notfound if the attachment does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/versions/both/attachments/my_file1.mp4')
            .expect(404)))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
            .expect(201))
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/versions/one/attachments')
              .expect(403))))));

    it('should return attachment data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
            .expect(201))
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .attach('xml_submission_file', Buffer.from(withBinaryIds('both', 'both2')), { filename: 'data.xml' })
            .expect(201))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/versions/both/attachments/here_is_file2.jpg')
              .expect(200)
              .then(({ body }) => { body.toString('utf8').should.equal('this is test file two'); }),
            asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/versions/both2/attachments/my_file1.mp4')
              .expect(200)
              .then(({ body }) => { body.toString('utf8').should.equal('this is test file one'); }),
          ])))));
  });

  describe('[draft] /:instanceId/attachments/:name GET', () => {
    it('should return a draft attachment', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments/my_file1.mp4')
            .send('this is file 1')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments/my_file1.mp4')
            .expect(200)
            .then(({ text }) => { text.should.equal('this is file 1'); })))));

    it('should not return a draft attachment nondraft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments/my_file1.mp4')
            .send('this is file 1')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
            .expect(404)))));
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should attach a given file with empty Content-Type and serve it with default mime type', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
              .send('testvideo')
              .set('Content-Type', '') // N.B. must be called _after_ send()
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .expect(200)
                .then(({ headers, body }) => {
                  headers['content-type'].should.equal('application/octet-stream');
                  body.toString().should.equal('testvideo');
                })))))));

    it('should attach a given file with missing Content-Type and serve it with default mime type', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
              .send('testvideo')
              .unset('Content-Type') // N.B. must be called _after_ send()
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .expect(200)
                .then(({ headers, body }) => {
                  headers['content-type'].should.equal('application/octet-stream');
                  body.toString().should.equal('testvideo');
                })))))));

    [
      // express ALWAYS adds "charset=..." suffix to text-based Content-Type response headers
      // See: https://github.com/expressjs/express/issues/2654
      [ 'CSV',     'myfile.csv',     'text/csv; charset=utf-8',  'a,b,c' ],    // eslint-disable-line no-multi-spaces
      [ 'GeoJSON', 'myfile.geojson', 'application/geo+json',     '{}' ],       // eslint-disable-line no-multi-spaces
      [ 'Custom',  'myfile.custom1', 'application/octet-stream', 'anything' ], // eslint-disable-line no-multi-spaces
    ].forEach(([ humanType, filename, officialContentType, fileContents ]) => {
      describe(`special handling for ${humanType}`, () => {
        it('should attach the given file and serve it with supplied mime type', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms?publish=true')
              .set('Content-Type', 'application/xml')
              .send(testData.forms.binaryType)
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
                .send(testData.instances.binaryType.withFile(filename))
                .set('Content-Type', 'text/xml')
                .expect(200)
                .then(() => asAlice.post(`/v1/projects/1/forms/binaryType/submissions/with-file/attachments/${filename}`)
                  .set('Content-Type', 'application/x-abiword')
                  .send(fileContents)
                  .expect(200)
                  .then(() => asAlice.get(`/v1/projects/1/forms/binaryType/submissions/with-file/attachments/${filename}`)
                    .expect(200)
                    .then(({ headers, text }) => {
                      headers['content-type'].should.equal('application/x-abiword');
                      text.toString().should.equal(fileContents); // use 'text' instead of 'body' to avoid supertest response parsing
                    })))))));

        it(`should attach a given ${humanType} file with empty Content-Type and serve it with mime type ${officialContentType}`, testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms?publish=true')
              .set('Content-Type', 'application/xml')
              .send(testData.forms.binaryType)
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
                .send(testData.instances.binaryType.withFile(filename))
                .set('Content-Type', 'text/xml')
                .expect(200)
                .then(() => asAlice.post(`/v1/projects/1/forms/binaryType/submissions/with-file/attachments/${filename}`)
                  .send(fileContents)
                  .set('Content-Type', '') // N.B. must be called _after_ send()
                  .expect(200)
                  .then(() => asAlice.get(`/v1/projects/1/forms/binaryType/submissions/with-file/attachments/${filename}`)
                    .expect(200)
                    .then(({ headers, body, text }) => {
                      headers['content-type'].should.equal(officialContentType);

                      // Both body & text must be checked here to avoid supertest response parsing:
                      // * for JSON-based formats, body will contain parsed JSON objects
                      // * for general binary formats, text will be undefined
                      (text ?? body).toString().should.equal(fileContents);
                    })))))));

        it(`should attach a given ${humanType} file with missing Content-Type and serve it with mime type ${officialContentType}`, testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms?publish=true')
              .set('Content-Type', 'application/xml')
              .send(testData.forms.binaryType)
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
                .send(testData.instances.binaryType.withFile(filename))
                .set('Content-Type', 'text/xml')
                .expect(200)
                .then(() => asAlice.post(`/v1/projects/1/forms/binaryType/submissions/with-file/attachments/${filename}`)
                  .send(fileContents)
                  .unset('Content-Type') // N.B. must be called _after_ send()
                  .expect(200)
                  .then(() => asAlice.get(`/v1/projects/1/forms/binaryType/submissions/with-file/attachments/${filename}`)
                    .expect(200)
                    .then(({ headers, body, text }) => {
                      headers['content-type'].should.equal(officialContentType);

                      // Both body & text must be checked here to avoid supertest response parsing:
                      // * for JSON-based formats, body will contain parsed JSON objects
                      // * for general binary formats, text will be undefined
                      (text ?? body).toString().should.equal(fileContents);
                    })))))));
      });
    });

    it('should log an audit entry about initial attachment', testService((service, { Audits, Forms, Submissions, SubmissionAttachments }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then(() => Forms.getByProjectAndXmlFormId(1, 'binaryType', Form.WithoutDef))
          .then((o) => o.get())
          .then((form) => Submissions.getAnyDefByFormAndInstanceId(form.id, 'both', false)
            .then((o) => o.get())
            .then((def) => SubmissionAttachments.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4')
              .then((o) => o.get())
              .then((attachment) => Promise.all([
                asAlice.get('/v1/users/current').expect(200),
                Audits.getLatestByAction('submission.attachment.update')
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
                })))))));

    it('should log an audit entry about reattachment', testService((service, { Audits, Forms, Submissions, SubmissionAttachments }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then(() => Forms.getByProjectAndXmlFormId(1, 'binaryType', Form.WithoutDef))
          .then((o) => o.get())
          .then((form) => Submissions.getAnyDefByFormAndInstanceId(form.id, 'both', false)
            .then((o) => o.get())
            .then((def) => SubmissionAttachments.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4')
              .then((o) => o.get())
              .then((oldAttachment) => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .set('Content-Type', 'video/mp4')
                .send('testvideo2')
                .expect(200)
                .then(() => Promise.all([
                  asAlice.get('/v1/users/current').expect(200),
                  SubmissionAttachments.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4').then((o) => o.get()),
                  Audits.getLatestByAction('submission.attachment.update')
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
                  }))))))));
  });

  // the draft version of this is already tested above with :name GET

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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
                    // eslint-disable-next-line no-multi-spaces
                    .then(({ body }) =>  {
                      body.should.eql([
                        { name: 'here_is_file2.jpg', exists: false },
                        { name: 'my_file1.mp4', exists: false }
                      ]);
                    })))))))));

    it('should log an audit entry about the deletion', testService((service, { Audits, Forms, Submissions, SubmissionAttachments }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then(() => Forms.getByProjectAndXmlFormId(1, 'binaryType', Form.WithoutDef))
          .then((o) => o.get())
          .then((form) => Submissions.getAnyDefByFormAndInstanceId(form.id, 'both', false)
            .then((o) => o.get())
            .then((def) => SubmissionAttachments.getBySubmissionDefIdAndName(def.id, 'my_file1.mp4')
              .then((o) => o.get())
              .then((attachment) => asAlice.delete('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .expect(200)
                .then(() => Promise.all([
                  asAlice.get('/v1/users/current').expect(200),
                  Audits.getLatestByAction('submission.attachment.update')
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
                  }))))))));
  });

  describe('[draft] /:instanceId/attachments/:name DELETE', () => {
    it('should delete a draft attachment', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments/my_file1.mp4')
            .send('this is file 1')
            .expect(200))
          .then(() => asAlice.delete('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments/my_file1.mp4')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments/my_file1.mp4')
            .expect(404)))));

    it('should not delete a draft attachment nondraft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions')
            .send(testData.instances.binaryType.both)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/binaryType/draft/submissions/both/attachments/my_file1.mp4')
            .send('this is file 1')
            .expect(200))
          .then(() => asAlice.delete('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
            .expect(404)))));
  });

  describe('/:instanceId/versions GET', () => {
    it('should return notfound if the root does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/versions').expect(403))))));

    it('should return submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one.replace(/<\/meta>/, '<orx:instanceName>custom name</orx:instanceName></meta>'))
          .set('Content-Type', 'text/xml')
          .set('User-Agent', 'central-tests/1')
          .expect(200)
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one?deviceID=updateDevice')
            .send(withSimpleIds('one', 'two'))
            .set('Content-Type', 'text/xml')
            .set('User-Agent', 'central-tests/2')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body[0].should.be.a.SubmissionDef();
              body[1].should.be.a.SubmissionDef();
              body[0].submitterId.should.equal(5);
              body[1].submitterId.should.equal(5);
              should(body[0].instanceName).equal(null);
              body[1].instanceName.should.equal('custom name');

              body[0].deviceId.should.equal('updateDevice');
              (body[1].deviceId == null).should.equal(true);
              body[0].userAgent.should.equal('central-tests/2');
              body[1].userAgent.should.equal('central-tests/1');
            })))));

    it('should return extended submission details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2.0"'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
            .expect(200))
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .send(testData.instances.simple.one
              .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')
              .replace('id="simple"', 'id="simple" version="2.0"'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions')
            .set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              body[0].should.be.an.ExtendedSubmissionDef();
              body[0].formVersion.should.equal('2.0');
              body[0].submitter.displayName.should.equal('Alice');
              body[1].should.be.an.ExtendedSubmissionDef();
              body[1].formVersion.should.equal('');
              body[1].submitter.displayName.should.equal('Alice');
            })))));
  });

  context('[version] partitioning', () => {
    it('should keep draft/nondraft versions apart', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one.replace(/<\/meta>/, '<orx:instanceName>custom name</orx:instanceName></meta>'))
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/one')
              .expect(200)
              .then(({ body }) => { body.instanceName.should.equal('custom name'); }),
            asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one/versions/one')
              .expect(200)
              .then(({ body }) => { should(body.instanceName).equal(null); })
          ])))));

    it('should keep project versions apart', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one.replace(/<\/meta>/, '<orx:instanceName>custom name</orx:instanceName></meta>'))
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects')
            .send({ name: 'project two' })
            .expect(200)
            .then(({ body }) => body.id)
            .then((projectId) => asAlice.post(`/v1/projects/${projectId}/forms?publish=true`)
              .send(testData.forms.simple)
              .expect(200)
              .then(() => asAlice.post(`/v1/projects/${projectId}/forms/simple/submissions`)
                .send(testData.instances.simple.one)
                .set('Content-Type', 'text/xml')
                .expect(200))
              .then(() => Promise.all([
                asAlice.get('/v1/projects/1/forms/simple/submissions/one/versions/one')
                  .expect(200)
                  .then(({ body }) => { body.instanceName.should.equal('custom name'); }),
                asAlice.get(`/v1/projects/${projectId}/forms/simple/submissions/one/versions/one`)
                  .expect(200)
                  .then(({ body }) => { should(body.instanceName).equal(null); })
              ])))))));
  });

  describe('[draft] /test POST', () => {
    it('should reject notfound if there is no draft', testService(async (service) => {
      await service.post('/v1/test/dummykey/projects/1/forms/simple/draft/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(404);
    }));

    it('should reject if the draft has been published', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft')
        .expect(200);

      const token = await asAlice.get('/v1/projects/1/forms/simple/draft')
        .then(({ body }) => body.draftToken);

      await asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
        .expect(200);

      await service.post(`/v1/test/${token}/projects/1/forms/simple/draft/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(404);
    }));

    it('should reject if the draft has been deleted', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft')
        .expect(200);

      const token = await asAlice.get('/v1/projects/1/forms/simple/draft')
        .then(({ body }) => body.draftToken);

      await asAlice.delete('/v1/projects/1/forms/simple/draft')
        .expect(200);

      await service.post(`/v1/test/${token}/projects/1/forms/simple/draft/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(404);
    }));

    it('should reject if the key is wrong', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft')
        .expect(200);

      await service.post(`/v1/test/dummytoken/projects/1/forms/simple/draft/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(404);
    }));

    it('should reject if the draft has been deleted', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft')
        .expect(200);

      const token = await asAlice.get('/v1/projects/1/forms/simple/draft')
        .then(({ body }) => body.draftToken);

      await service.post(`/v1/test/${token}/projects/1/forms/simple/draft/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one')
        .expect(200)
        .then(({ body }) => {
          body.createdAt.should.be.a.recentIsoDate();
          should.not.exist(body.deviceId);
        });

      await asAlice.get('/v1/projects/1/forms/simple/draft/submissions/one.xml')
        .expect(200)
        .then(({ text }) => { text.should.equal(testData.instances.simple.one); });

      await asAlice.get('/v1/projects/1/forms/simple/submissions/one')
        .expect(404);
    }));
  });
});

