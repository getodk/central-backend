const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const config = require('config');
const superagent = require('superagent');
const { DateTime } = require('luxon');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: /projects/:id/forms', () => {
  describe('GET', () => {
    it('should reject unless the user can list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms').expect(403))));

    it('should list forms in order', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms')
          .expect(200)
          .then(({ body }) => {
            body.forEach((form) => form.should.be.a.Form());
            body.map((form) => form.projectId).should.eql([ 1, 1 ]);
            body.map((form) => form.xmlFormId).should.eql([ 'simple', 'withrepeat' ]);
            body.map((form) => form.hash).should.eql([ '5c09c21d4c71f2f13f6aa26227b2d133', 'e7e9e6b3f11fca713ff09742f4312029' ]);
            body.map((form) => form.version).should.eql([ '', '1.0' ]);
          }))));

    it('should provide extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.forEach((form) => form.should.be.an.ExtendedForm());
              const simple = body.find((form) => form.xmlFormId === 'simple');
              simple.submissions.should.equal(1);
              simple.lastSubmission.should.be.a.recentIsoDate();
            })))));
  });

  describe('../formList GET', () => {
    it('should return no results if the user cannot read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/formList')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            text.should.eql(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  </xforms>`);
          }))));

    it('should return form details as xml', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/formList')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text, headers }) => {
            // Collect is particular about this:
            headers['content-type'].should.equal('text/xml; charset=utf-8');

            const domain = config.get('default.env.domain');
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>simple</formID>
      <name>Simple</name>
      <version></version>
      <hash>md5:5c09c21d4c71f2f13f6aa26227b2d133</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/simple.xml</downloadUrl>
    </xform>
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
          }))));

    it('should return auth-filtered results for app users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test' })
          .expect(200)
          .then(({ body }) => body)
          .then((fk) => asAlice.post(`/v1/projects/1/forms/withrepeat/assignments/app-user/${fk.id}`)
            .expect(200)
            .then(() => service.get(`/v1/key/${fk.token}/projects/1/formList`)
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text, headers }) => {
                // Collect is particular about this:
                headers['content-type'].should.equal('text/xml; charset=utf-8');

                const domain = config.get('default.env.domain');
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/key/${fk.token}/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
              }))))));

    it('should not include closing/closed forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/withrepeat')
          .send({ state: 'closing' })
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple')
            .send({ state: 'closing' })
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/formList')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  </xforms>`);
              }))))));

    it('should not include deleted forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/withrepeat')
          .expect(200)
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/formList')
              .set('X-OpenRosa-Version', '1.0')
              .set('Date', DateTime.local().toHTTP())
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  </xforms>`);
              }))))));

    it('should escape illegal characters in url', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments.replace('withAttachments', 'with attachments'))
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/formList')
            .set('X-OpenRosa-Version', '1.0')
            .expect(200)
            .then(({ text }) => {
              const domain = config.get('default.env.domain');
              text.should.containEql(`<downloadUrl>${domain}/v1/projects/1/forms/with%20attachments.xml</downloadUrl>`);
              text.should.containEql(`<manifestUrl>${domain}/v1/projects/1/forms/with%20attachments/manifest</manifestUrl>`);
            })))));

    it('should include a manifest node for forms with attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/formList')
            .set('X-OpenRosa-Version', '1.0')
            .expect(200)
            .then(({ text }) => {
              const domain = config.get('default.env.domain');
              text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>simple</formID>
      <name>Simple</name>
      <version></version>
      <hash>md5:5c09c21d4c71f2f13f6aa26227b2d133</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/simple.xml</downloadUrl>
    </xform>
    <xform>
      <formID>withAttachments</formID>
      <name>withAttachments</name>
      <version></version>
      <hash>md5:7eb21b5b123b0badcf2b8f50bcf1cbd0</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments.xml</downloadUrl>
      <manifestUrl>${domain}/v1/projects/1/forms/withAttachments/manifest</manifestUrl>
    </xform>
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
            })))));

    it('should list the correct form given duplicates across projects', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'Project Two' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectTwoId) => asAlice.post(`/v1/projects/${projectTwoId}/forms`)
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => Promise.all([
              asAlice.get('/v1/projects/1/formList')
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>simple</formID>
      <name>Simple</name>
      <version></version>
      <hash>md5:5c09c21d4c71f2f13f6aa26227b2d133</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/simple.xml</downloadUrl>
    </xform>
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
                }),
              asAlice.get(`/v1/projects/${projectTwoId}/formList`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>simple</formID>
      <name>Simple</name>
      <version>two</version>
      <hash>md5:8240cdc372a373170ee87c1eab2c60bc</hash>
      <downloadUrl>${domain}/v1/projects/${projectTwoId}/forms/simple.xml</downloadUrl>
    </xform>
  </xforms>`);
                })
            ]))))));
  });

  describe('POST', () => {
    it('should reject unless the user can create', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(403))));

    it('should reject if the xml is malformed', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send('<hello')
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.2);
            body.details.field.should.equal('formId');
            /* gh #45 when we have a real xml validator this should be the response:
            body.code.should.equal(400.1);
            body.details.should.eql({ format: 'xml', rawLength: 6 });*/
          }))));

    it('should reject if the form id cannot be found', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send('<test/>')
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.2);
            body.details.should.eql({ field: 'formId' });
          }))));

    it('should reject if the form id already exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple)
          .set('Content-Type', 'application/xml')
          .expect(409)
          .then(({ body }) => {
            body.code.should.equal(409.3);
            body.details.fields.should.eql([ 'projectId', 'xmlFormId' ]);
            body.details.values.should.eql([ '1', 'simple' ]);
          }))));

    // the simple form has no version declaration at all, which is what we want
    // to test, as postgres does not enforce uniqueness on null values. the
    // simple form is preloaded as part of the initial fixtures so we simply start
    // by deleting it.
    it('should reject if an empty form version already existed but was deleted', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(409)
            .then(({ body }) => {
              body.details.fields.should.eql([ 'projectId', 'xmlFormId', 'version' ]);
              body.details.values.should.eql([ '1', 'simple', '' ]);
            })))));

    it('should return the created form upon success', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.name.should.equal('Simple 2');
            body.version.should.equal('2.1');
            body.hash.should.equal('07ed8a51cc3f6472b7dfdc14c2005861');
          }))));

    it('should reject if form id is too long', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple.replace(/id=".*"/i, 'id="simple_form_with_form_id_length_more_than_sixty_four_characters_long"'))
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.13);
          }))));

    it('should accept and convert valid xlsx files', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .set('X-XlsForm-FormId-Fallback', 'testformid')
          .expect(200)
          .then(({ body }) => {
            // this checks that the conversion service received the correct xlsx bits:
            global.xlsformHash.should.equal('9ebd53024b8560ffd0b84763481ed24159ca600f');
            global.xlsformFallback.should.equal('testformid');

            // these check appropriate plumbing of the mock conversion service response:
            body.sha.should.equal('466b8cf532c22aea7b1791ea2e6712ab31ce90a4');
            body.xmlFormId.should.equal('simple2');
          }))));

    it('should fail on warnings even for valid xlsx files', testService((service) => {
      global.xlsformTest = 'warning'; // set up the mock service to warn.
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.16);
            body.details.should.eql({ warnings: [ 'warning 1', 'warning 2' ] });
          }));
    }));

    it('should create the form for xlsx files with warnings given ignoreWarnings', testService((service) => {
      global.xlsformTest = 'warning'; // set up the mock service to warn.
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(200)
          .then(({ body }) => {
            body.sha.should.equal('466b8cf532c22aea7b1791ea2e6712ab31ce90a4');
            body.xmlFormId.should.equal('simple2');
          }));
    }));

    it('should return an appropriate response upon conversion error', testService((service) => {
      global.xlsformTest = 'error'; // set up the mock service to fail.
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(400)
          .then(({ body }) => {
            body.should.eql({
              message: 'The given XLSForm file was not valid. Please see the error details for more information.',
              code: 400.15,
              details: {
                error: 'Error: could not convert file',
                warnings: [ 'warning 1', 'warning 2' ]
              }
            });
          }));
    }));

    // we cheat here. because we don't even actually send the file to a real xls
    // convertor, we just send the xlsx form anyway, but signal an xls file via
    // the mime type.
    it('should accept xls forms and return them over that endpoint', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.ms-excel')
          .set('X-XlsForm-FormId-Fallback', 'testformid')
          .expect(200)
          .then(({ body }) => {
            // this checks that the conversion service received the correct xlsx bits:
            global.xlsformHash.should.equal('9ebd53024b8560ffd0b84763481ed24159ca600f');
            global.xlsformFallback.should.equal('testformid');

            // these check appropriate plumbing of the mock conversion service response:
            body.sha.should.equal('466b8cf532c22aea7b1791ea2e6712ab31ce90a4');
            body.xmlFormId.should.equal('simple2');
          }))));
  });

  describe('/:id.xlsx GET', () => {
    it('should return notfound if the form does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/xyz.xls').expect(404))));

    it('should return notfound if the form was not created by xlsform', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple.xlsx').expect(404))));

    it('should reject if the user cannot read', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple2.xlsx')
              .expect(403))))));

    it('should return xls notfound given xlsx file', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.xls')
            .expect(404)))));

    it('should return the xlsx file originally provided', testService((service) => {
      const input = readFileSync(appRoot + '/test/data/simple.xlsx');
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(input)
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
            .buffer(true).parse(superagent.parse['application/octet-stream'])
            .expect(200)
            .then(({ headers, body }) => {
              headers['content-type'].should.equal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              headers['content-disposition'].should.equal('attachment; filename="simple2.xlsx"');
              Buffer.compare(input, body).should.equal(0);
            })));
    }));
  });

  describe('/:id.xls GET', () => {
    // we don't bother with running all the 404/403/etc tests since it's the same
    // code as above. so just test the delta. we also cheat, as with POST .xls, and
    // just submit the .xlsx to the mock test service.
    it('should allow xls file download only', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.ms-excel')
          .set('X-XlsForm-FormId-Fallback', 'testformid')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.xls').expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx').expect(404)))));
  });

  describe('/:id.xml GET', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple.xml').expect(403))));

    it('should return just xml', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple.xml')
          .expect(200)
          .then(({ text }) => {
            text.should.equal(testData.forms.simple);
          }))));

    it('should get the correct form given duplicates across projects', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'Project Two' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectTwoId) => asAlice.post(`/v1/projects/${projectTwoId}/forms`)
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => Promise.all([
              asAlice.get('/v1/projects/1/forms/simple.xml')
                .expect(200)
                .then(({ text }) => { text.includes('version="two"').should.equal(false); }),
              asAlice.get(`/v1/projects/${projectTwoId}/forms/simple.xml`)
                .expect(200)
                .then(({ text }) => { text.includes('version="two"').should.equal(true); })
            ]))))));
  });

  describe('/:id/preview POST', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/projects/1/forms/simple/preview').expect(403))));

    it('should return json with preview url and code', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/preview')
          .expect(201)
          .then(({ body }) =>
            body.should.eql({ preview_url: 'http://enke.to/preview/::abcdefgh', code: 201 })
          ))));

    it('should fail if Enketo returns an unexpected response', testService((service) => {
      global.enketoPreviewTest = 'error'; // set up the mock service to fail.
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/preview')
          .expect(500)
          .then(({ body }) => {
            body.code.should.equal(500.4);
            body.message.should.equal('The Enketo service returned an unexpected response.');
          }))
    }));
  });

  describe('/:id/manifest GET', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(403))));

    it('should return no files if no attachments exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
          }))));

    it('should include attachments that have been uploaded', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
            .send('test,csv\n1,2')
            .set('Content-Type', 'text/csv')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                const domain = config.get('default.env.domain');
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile>
      <filename>goodone.csv</filename>
      <hash>md5:2241de57bbec8144c8ad387e69b3a3ba</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/goodone.csv</downloadUrl>
    </mediaFile>
  </manifest>`);
              }))))));
  });

  describe('/:id.schema.json GET', () => {
    // we do not deeply test the JSON itself; that is done in test/unit/data/schema.js
    // here we just check all the plumbing.

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple.schema.json').expect(403))));

    it('should return a JSON schema structure', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple.schema.json')
          .expect(200)
          .then(({ body }) => {
            body.should.eql([{
              name: 'meta', type: 'structure',
              children: [{ name: 'instanceID', type: 'string' }]
            }, {
              name: 'name', type: 'string',
            }, {
              name: 'age', type: 'int',
            }])
          }))));

    it('should return a flattened JSON schema structure', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple.schema.json?flatten=true')
          .expect(200)
          .then(({ body }) => {
            body.should.eql([
              { path: [ 'meta', 'instanceID' ], type: 'string' },
              { path: [ 'name' ], type: 'string' },
              { path: [ 'age' ], type: 'int' }
            ]);
          }))));

    const sanitizeXml = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Sanitize</h:title>
    <model>
      <instance>
        <data id="sanitize">
          <q1.8>
            <17/>
          </q1.8>
          <4.2/>
        </data>
      </instance>

      <bind nodeset="/data/q1.8/17" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/4.2" type="number"/>
    </model>

  </h:head>
  <h:body>
    <input ref="/data/4.2">
      <label>What is your age?</label>
    </input>
  </h:body>
</h:html>`;

    it('should return a sanitized JSON schema structure', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(sanitizeXml)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/sanitize.schema.json?odata=true')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([{
                name: 'q1_8',
                type: 'structure',
                children: [{
                  name: '_17',
                  type: 'string'
                }]
              }, {
                name: '_4_2',
                type: 'number'
              }]);
            })))));

    it('should return a sanitized flattened JSON schema structure', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(sanitizeXml)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/sanitize.schema.json?odata=true&flatten=true')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([
                { path: [ 'q1_8', '_17' ], type: 'string' },
                { path: [ '_4_2' ], type: 'number' }
              ]);
            })))));
  });

  describe('/:id GET', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple').expect(403))));

    it('should return basic form details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.xmlFormId.should.equal('simple');
            body.hash.should.equal('5c09c21d4c71f2f13f6aa26227b2d133');
          }))));

    it('should return encrypted form keyId', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'encryptme' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(200)
            .then(({ body }) => {
              body.keyId.should.be.a.Number();
            })))));

    it('should return extended form details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.should.be.an.ExtendedForm();
              body.xmlFormId.should.equal('simple2');
              (body.lastSubmission == null).should.equal(true);
              body.submissions.should.equal(0);
              body.createdBy.should.be.an.Actor();
              body.createdBy.displayName.should.equal('Alice');
            })))));
  });

  describe('/:id PATCH', () => {
    it('should reject unless the user can update', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.patch('/v1/projects/1/forms/simple')
          .send({ name: 'a new name!' })
          .expect(403))));

    it('should update allowed fields', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ name: 'a fancy name', state: 'draft' })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.name.should.equal('a fancy name');
            body.state.should.equal('draft');
          })
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Form();
              body.name.should.equal('a fancy name');
              body.state.should.equal('draft');
            })))));

    it('should reject if state is invalid', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ name: 'a cool name', state: 'the coolest' })
          .expect(400))));

    it('should not update disallowed fields', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ xmlFormId: 'changed', xml: 'changed', hash: 'changed' })
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.xmlFormId.should.equal('simple');
                body.hash.should.equal('5c09c21d4c71f2f13f6aa26227b2d133');
              }),
            asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(testData.forms.simple);
              })
          ])))));

    it('should log the action in the audit log', testService((service, { Project, Form, User, Audit }) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ name: 'a fancy name', state: 'draft' })
          .expect(200)
          .then(() => Promise.all([
            User.getByEmail('alice@opendatakit.org').then((o) => o.get()),
            Project.getById(1).then((o) => o.get())
              .then((project) => project.getFormByXmlFormId('simple')).then((o) => o.get()),
            Audit.getLatestByAction('form.update').then((o) => o.get())
          ])
          .then(([ alice, form, log ]) => {
            log.actorId.should.equal(alice.actor.id);
            log.acteeId.should.equal(form.acteeId);
            log.details.should.eql({ data: { name: 'a fancy name', state: 'draft', def: {} } });
          })))));
  });

  describe('/:id DELETE', () => {
    it('should reject unless the user can delete', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.delete('/v1/projects/1/forms/simple').expect(403))));

    it('should delete the form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(404)))));

    it('should log the action in the audit log', testService((service, { Project, Form, User, Audit }) =>
      service.login('alice', (asAlice) =>
        Project.getById(1).then((o) => o.get())
          .then((project) => project.getFormByXmlFormId('simple')).then((o) => o.get())
          .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => Promise.all([
              User.getByEmail('alice@opendatakit.org').then((o) => o.get()),
              Audit.getLatestByAction('form.delete').then((o) => o.get())
            ])
            .then(([ alice, log ]) => {
              log.actorId.should.equal(alice.actor.id);
              log.acteeId.should.equal(form.acteeId);
            }))))));
  });

  // Form attachments tests:
  describe('/:id/attachments', () => {
    describe('/ GET', () => {
      it('should reject notfound if the form does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/withAttachments/attachments').expect(404))));

      it('should reject if the user cannot read the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/withAttachments/attachments')
                .expect(403))))));

      it('should return an empty list if no attachments exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/simple/attachments')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([]);
            }))));

      it('should return a list of files', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: false },
                  { name: 'goodtwo.mp3', type: 'audio', exists: false }
                ]);
              })))));

      // this test overlaps with/depends on POST /:name
      it('should flag exists: true for extant files', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
                .expect(200)
                .then(({ body }) => {
                  body[0].updatedAt.should.be.a.recentIsoDate();
                  delete body[0].updatedAt;

                  body.should.eql([
                    { name: 'goodone.csv', type: 'file', exists: true },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false }
                  ]);
                }))))));

      // this test overlaps with/depends on POST /:name
      it('should return upload updatedAt for extended metadata', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body }) => {
                  body[0].name.should.equal('goodone.csv'); // sanity
                  body[0].exists.should.equal(true);
                  body[0].updatedAt.should.be.a.recentIsoDate();
                }))))));

      // this test overlaps with/depends on POST /:name and DELETE /:name
      it('should return deletion exists and updatedAt for extended metadata', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then((firstListing) => asAlice.delete('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
                    .set('X-Extended-Metadata', 'true')
                    .expect(200)
                    .then((secondListing) => {
                      secondListing.body[0].exists.should.equal(false);
                      secondListing.body[0].updatedAt.should.be.a.recentIsoDate();

                      const firstUpdatedAt = DateTime.fromISO(firstListing.body[0].updatedAt);
                      const secondUpdatedAt = DateTime.fromISO(secondListing.body[0].updatedAt);
                      secondUpdatedAt.should.be.greaterThan(firstUpdatedAt);
                    }))))))));
    });

    describe('/:name POST', () => {
      it('should reject notfound if the form does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
            .send('test,csv\n1,2')
            .set('Content-Type', 'text/csv')
            .expect(404))));

      it('should reject unless the user may modify the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(403))))));

      it('should accept the file with a success result', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(({ body }) => {
                body.should.eql({ success: true });
              })))));

      it('should replace an extant file with another', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .send('replaced,csv\n3,4')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                  .expect(200)
                  .then(({ text }) => {
                    text.should.equal('replaced,csv\n3,4');
                  })))))));

      it('should allow the same file in different slots', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodtwo.mp3')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200))))));

      it('should log the action in the audit log', testService((service, { Project, Form, FormAttachment, User, Audit }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => Promise.all([
                User.getByEmail('alice@opendatakit.org').then((o) => o.get()),
                Project.getById(1).then((o) => o.get())
                  .then((project) => project.getFormByXmlFormId('withAttachments')).then((o) => o.get())
                  .then((form) => FormAttachment.getByFormDefIdAndName(form.currentDefId, 'goodone.csv')
                    .then((o) => o.get())
                    .then((attachment) => [ form, attachment ])),
                Audit.getLatestByAction('form.attachment.update').then((o) => o.get())
              ])
              .then(([ alice, [ form, attachment ], log ]) => {
                log.actorId.should.equal(alice.actor.id);
                log.acteeId.should.equal(form.acteeId);
                log.details.should.eql({
                  formDefId: form.def.id,
                  name: attachment.name,
                  oldBlobId: null,
                  newBlobId: attachment.blobId
                });

                return asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                  .send('replaced,csv\n3,4')
                  .set('Content-Type', 'text/csv')
                  .expect(200)
                  .then(() => Promise.all([
                    FormAttachment.getByFormDefIdAndName(form.currentDefId, 'goodone.csv').then((o) => o.get()),
                    Audit.getLatestByAction('form.attachment.update').then((o) => o.get())
                  ]))
                  .then(([ attachment2, log2 ]) => {
                    log2.actorId.should.equal(alice.actor.id);
                    log2.acteeId.should.equal(form.acteeId);
                    log2.details.should.eql({
                      formDefId: form.def.id,
                      name: attachment.name,
                      oldBlobId: attachment.blobId,
                      newBlobId: attachment2.blobId
                    });
                  });
              }))))));
    });

    // these tests mostly necessarily depend on /:name POST:
    describe('/:name GET', () => {
      it('should reject notfound if the form does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
            .expect(404))));

      it('should reject unless the user may read the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => service.login('chelsea', (asChelsea) =>
                asChelsea.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .expect(403)))))));

      it('should reject notfound if the file does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .expect(404)))));

      it('should return file contents with appropriate headers', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .expect(200)
                .then(({ headers, text }) => {
                  headers['content-disposition'].should.equal('attachment; filename="goodone.csv"');
                  headers['content-type'].should.equal('text/csv; charset=utf-8');
                  text.should.equal('test,csv\n1,2');
                }))))));
    });

    // these tests mostly necessarily depend on /:name POST:
    describe('/:name DELETE', () => {
      it('should reject notfound if the form does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
            .expect(404))));

      it('should reject unless the user may update the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => service.login('chelsea', (asChelsea) =>
                asChelsea.delete('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .expect(403)))))));

      it('should reject notfound if the file does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .expect(404)))));

      it('should delete the attachment contents', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => asAlice.delete('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .expect(200)
                .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                  .expect(404)))))));

      it('should log the action in the audit log', testService((service, { Project, Form, FormAttachment, User, Audit }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200)
              .then(() => Promise.all([
                User.getByEmail('alice@opendatakit.org').then((o) => o.get()),
                Project.getById(1).then((o) => o.get())
                  .then((project) => project.getFormByXmlFormId('withAttachments'))
                  .then((o) => o.get())
                  .then((form) => FormAttachment.getByFormDefIdAndName(form.currentDefId, 'goodone.csv')
                    .then((o) => o.get())
                    .then((attachment) => [ form, attachment ]))
              ]))
              .then(([ alice, [ form, attachment ] ]) =>
                asAlice.delete('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                  .expect(200)
                  .then(() => Audit.getLatestByAction('form.attachment.update').then((o) => o.get()))
                  .then((log) => {
                    log.actorId.should.equal(alice.actor.id);
                    log.acteeId.should.equal(form.acteeId);
                    log.details.should.eql({
                      formDefId: form.def.id,
                      name: 'goodone.csv',
                      oldBlobId: attachment.blobId,
                      newBlobId: null
                    });
                  }))))));

      // n.b. setting the appropriate updatedAt value is tested above in the / GET
      // extended metadata listing test!
    });
  });
});

