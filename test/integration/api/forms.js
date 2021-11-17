const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const config = require('config');
const superagent = require('superagent');
const { DateTime } = require('luxon');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('api: /projects/:id/forms', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // FORM LISTINGS
  ////////////////////////////////////////////////////////////////////////////////

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
            body.map((form) => form.name).should.eql([ 'Simple', null ]);
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
    it('should reject if there is no authentication', testService((service) =>
      service.get('/v1/projects/1/formList')
        .set('X-OpenRosa-Version', '1.0')
        .expect(401)));

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

    it('should return only return matching form given formID=', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/formList?formID=withrepeat')
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
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
          }))));

    it('should return nothing given a nonmatching formID=', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/formList?formID=xyz')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text, headers }) => {
            // Collect is particular about this:
            headers['content-type'].should.equal('text/xml; charset=utf-8');

            const domain = config.get('default.env.domain');
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
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

    it('should prefix returned routes for app users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test' })
          .expect(200)
          .then(({ body }) => body)
          .then((fk) => asAlice.post(`/v1/projects/1/forms/withrepeat/assignments/app-user/${fk.id}`)
            .expect(200)
            .then(() => service.get(`/v1/projects/1/formList?st=${fk.token}`)
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

    it('should not include forms without published versions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/formList')
              .set('X-OpenRosa-Version', '1.0')
            .expect(200)
            .then(({ text }) => {
              text.includes('simple2').should.equal(false);
            })))));

    it('should escape illegal characters in url', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
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
        asAlice.post('/v1/projects/1/forms?publish=true')
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
          .then((projectTwoId) => asAlice.post(`/v1/projects/${projectTwoId}/forms?publish=true`)
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


  ////////////////////////////////////////////////////////////////////////////////
  // FORM CREATION+IMPORT
  ////////////////////////////////////////////////////////////////////////////////

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
          .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should reject if form id ends in .xml', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple.replace(/id=".*"/i, 'id="formid.xml"'))
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.8);
          }))));

    it('should reject if form id ends in .xls(x)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple.replace(/id=".*"/i, 'id="formid.xls"'))
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.8);
          })
          .then(asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple.replace(/id=".*"/i, 'id="formid.xlsx"'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.8);
            })))));

    it('should reject if form id contains is too long', testService((service) =>
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

    it('should apply itemsets.csv if it is returned and expected', testService((service) => {
      global.xlsformForm = 'itemsets';
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .set('X-XlsForm-FormId-Fallback', 'itemsets')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/itemsets/draft/attachments/itemsets.csv')
            .expect(200)
            .then(({ text }) => {
              text.should.equal('a,b,c\n1,2,3\n4,5,6');
            })));
    }));

    it('should ignore itemsets.csv if it is returned but not expected', testService((service) => {
      global.xlsformForm = 'extra-itemsets';
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .set('X-XlsForm-FormId-Fallback', 'simple2')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft/attachments')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([]);
            })));
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

    it('should by default save the given definition as the draft', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2')
            .expect(200)
            .then(({ body }) => {
              should.not.exist(body.publishedAt);
              body.name.should.equal('Simple 2');
              body.version.should.equal('2.1');
              body.hash.should.equal('07ed8a51cc3f6472b7dfdc14c2005861');
              body.sha.should.equal('466b8cf532c22aea7b1791ea2e6712ab31ce90a4');
              body.sha256.should.equal('d438bdfb5c0b9bb800420363ca8900d26c3e664945d4ffc41406cbc599e43cae');
            }))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft')
            .expect(200)
            .then(({ body }) => {
              body.name.should.equal('Simple 2');
              body.version.should.equal('2.1');
              body.hash.should.equal('07ed8a51cc3f6472b7dfdc14c2005861');
              body.sha.should.equal('466b8cf532c22aea7b1791ea2e6712ab31ce90a4');
              body.sha256.should.equal('d438bdfb5c0b9bb800420363ca8900d26c3e664945d4ffc41406cbc599e43cae');
              body.draftToken.should.be.a.token();
            })))));

    it('should worker-process the form draft over to enketo', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200)
          .then(() => exhaust(container))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft')
            .expect(200)
            .then(({ body }) => {
              body.enketoId.should.equal('::abcdefgh');
              should.not.exist(body.enketoOnceId);
            })))));

    it('should worker-process the published form over to enketo', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200)
          .then(() => exhaust(container))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2')
            .expect(200)
            .then(({ body }) => {
              body.enketoId.should.equal('::abcdefgh');
              body.enketoOnceId.should.equal('::::abcdefgh');
            })))));

    it('should if flagged save the given definition as published', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2')
            .expect(200)
            .then(({ body }) => {
              body.version.should.equal('2.1');
              body.hash.should.equal('07ed8a51cc3f6472b7dfdc14c2005861');
              body.sha.should.equal('466b8cf532c22aea7b1791ea2e6712ab31ce90a4');
              body.sha256.should.equal('d438bdfb5c0b9bb800420363ca8900d26c3e664945d4ffc41406cbc599e43cae');
              should.not.exist(body.draftToken);
            }))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft')
            .expect(404)))));

    it('should set the publish date if flagged publish=true', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2')
            .expect(200)
            .then(({ body }) => {
              body.publishedAt.should.be.a.recentIsoDate();
            })))));

    it('should log the action in the audit log', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/audits?action=form')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].action.should.equal('form.create');
            })))));

    it('should log both actions in the audit log on publish=true', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/audits?action=form')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body[0].action.should.equal('form.update.publish');
              body[1].action.should.equal('form.create');
            })))));
  });


  ////////////////////////////////////////////////////////////////////////////////
  // FORM PRIMARY/PUBLISHED (READ-ONLY) RESOURCE
  ////////////////////////////////////////////////////////////////////////////////

  describe('/:id', () => {

    ////////////////////////////////////////
    // ROOT SINGULAR

    describe('.xlsx GET', () => {
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
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(input)
            .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
              .buffer(true).parse(superagent.parse['application/octet-stream'])
              .expect(200)
              .then(({ headers, body }) => {
                headers['content-type'].should.equal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                headers['content-disposition'].should.equal('attachment; filename="simple2.xlsx"; filename*=UTF-8\'\'simple2.xlsx');
                Buffer.compare(input, body).should.equal(0);
              })));
      }));

      it('should return the xlsx file originally provided', testService((service) => {
        const input = readFileSync(appRoot + '/test/data/simple.xlsx');
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(input)
            .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
              .send(input)
              .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft.xlsx')
              .buffer(true).parse(superagent.parse['application/octet-stream'])
              .expect(200)
              .then(({ headers, body }) => {
                headers['content-type'].should.equal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                headers['content-disposition'].should.equal('attachment; filename="simple2.xlsx"; filename*=UTF-8\'\'simple2.xlsx');
                Buffer.compare(input, body).should.equal(0);
              })));
      }));

      it('should continue to offer the xlsx file after a copy-draft', testService((service) => {
        const input = readFileSync(appRoot + '/test/data/simple.xlsx');
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(input)
            .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft').expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish?version=new').expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
              .buffer(true).parse(superagent.parse['application/octet-stream'])
              .expect(200)
              .then(({ headers, body }) => {
                headers['content-type'].should.equal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                headers['content-disposition'].should.equal('attachment; filename="simple2.xlsx"; filename*=UTF-8\'\'simple2.xlsx');
                Buffer.compare(input, body).should.equal(0);
              })));
      }));

      it('should not continue to offer the xlsx file after a noncopy-draft', testService((service) => {
        const input = readFileSync(appRoot + '/test/data/simple.xlsx');
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(input)
            .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
              .send(testData.forms.simple2)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish?version=new').expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
              .expect(404)));
      }));
    });

    describe('.xls GET', () => {
      // we don't bother with running all the 404/403/etc tests since it's the same
      // code as above. so just test the delta. we also cheat, as with POST .xls, and
      // just submit the .xlsx to the mock test service.
      it('should allow xls file download only', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
            .set('Content-Type', 'application/vnd.ms-excel')
            .set('X-XlsForm-FormId-Fallback', 'testformid')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xls').expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx').expect(404)))));
    });

    describe('.xml GET', () => {
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
            .then((projectTwoId) => asAlice.post(`/v1/projects/${projectTwoId}/forms?publish=true`)
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

    describe('GET', () => {
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
              body.name.should.equal('Simple');
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
          asAlice.post('/v1/projects/1/forms?publish=true')
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

      it('should return xls content type with extended form details', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
            .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .set('X-XlsForm-FormId-Fallback', 'testformid')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple2')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.should.be.an.ExtendedForm();
                body.excelContentType.should.equal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              })))));

      it('should not return a draftToken', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple')
              .expect(200)
              .then(({ body }) => {
                should.not.exist(body.draftToken);
              })))));

      it('should not count draft submissions in its count', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.submissions.should.equal(0);
              })))));

    it('should return the correct enketoId', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200)
          .then(() => exhaust(container))
          .then(() => {
            global.enketoToken = '::ijklmnop';
            return asAlice.post('/v1/projects/1/forms/simple2/draft')
              .expect(200)
              .then(() => exhaust(container))
              .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                .set('X-Extended-Metadata', true)
                .expect(200)
                .then(({ body }) => {
                  body.enketoId.should.equal('::abcdefgh');
                  body.enketoOnceId.should.equal('::::abcdefgh');
                }));
          }))));
    });

    ////////////////////////////////////////
    // SUBRESOURCES

    describe('/manifest GET', () => {
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
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
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
              })))));
    });

    describe('/fields GET', () => {
      // we do not deeply test the fields themselves; that is done in test/unit/data/schema.js
      // here we just check all the plumbing.

      it('should reject unless the user can read', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/projects/1/forms/simple/fields').expect(403))));

      it('should return a list of fields', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/simple/fields')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([
                { name: 'meta', path: '/meta', type: 'structure', binary: null, selectMultiple: null },
                { name: 'instanceID', path: '/meta/instanceID', type: 'string', binary: null, selectMultiple: null },
                { name: 'name', path: '/name', type: 'string', binary: null, selectMultiple: null },
                { name: 'age', path: '/age', type: 'int', binary: null, selectMultiple: null }
              ]);
            }))));

      it('should indicate selectMultiple fields', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.selectMultiple)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/selectMultiple/fields')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'q1', path: '/q1', type: 'string', binary: null, selectMultiple: true },
                  { name: 'g1', path: '/g1', type: 'structure', binary: null, selectMultiple: null },
                  { name: 'q2', path: '/g1/q2', type: 'string', binary: null, selectMultiple: true }
                ]);
              })))));

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
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(sanitizeXml)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/sanitize/fields?odata=true')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'q1_8', path: '/q1_8', type: 'structure', binary: null, selectMultiple: null },
                  { name: '_17', path: '/q1_8/_17', type: 'string', binary: null, selectMultiple: null },
                  { name: '_4_2', path: '/_4_2', type: 'number', binary: null, selectMultiple: null }
                ]);
              })))));
    });

    describe('/attachments', () => {
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
            asAlice.post('/v1/projects/1/forms?publish=true')
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
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
                .expect(200)
                .then(({ body }) => {
                  body[0].updatedAt.should.be.a.recentIsoDate();
                  delete body[0].updatedAt;

                  body.should.eql([
                    { name: 'goodone.csv', type: 'file', exists: true },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false }
                  ]);
                })))));

        // this test overlaps with/depends on POST /:name
        it('should return upload updatedAt for extended metadata', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body }) => {
                  body[0].name.should.equal('goodone.csv'); // sanity
                  body[0].exists.should.equal(true);
                  body[0].updatedAt.should.be.a.recentIsoDate();
                })))));

        // this test overlaps with/depends on POST /:name and DELETE /:name
        it('should return deletion exists and updatedAt for extended metadata', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
                .set('X-Extended-Metadata', 'true')
                .expect(200))
              .then((firstListing) => asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .expect(200)
                .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                  .expect(200))
                .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
                  .set('X-Extended-Metadata', 'true')
                  .expect(200)
                  .then((secondListing) => {
                    secondListing.body[0].exists.should.equal(false);
                    secondListing.body[0].updatedAt.should.be.a.recentIsoDate();

                    const firstUpdatedAt = DateTime.fromISO(firstListing.body[0].updatedAt);
                    const secondUpdatedAt = DateTime.fromISO(secondListing.body[0].updatedAt);
                    secondUpdatedAt.should.be.aboveOrEqual(firstUpdatedAt);
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
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => service.login('chelsea', (asChelsea) =>
                asChelsea.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .expect(403))))));

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
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .expect(200)
                .then(({ headers, text }) => {
                  headers['content-disposition'].should.equal('attachment; filename="goodone.csv"; filename*=UTF-8\'\'goodone.csv');
                  headers['content-type'].should.equal('text/csv; charset=utf-8');
                  text.should.equal('test,csv\n1,2');
                })))));
      });
    });
  });


  ////////////////////////////////////////////////////////////////////////////////
  // LOGICAL FORM R/W OPERATIONS
  ////////////////////////////////////////////////////////////////////////////////

  describe('/:id PATCH', () => {
    it('should reject unless the user can update', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.patch('/v1/projects/1/forms/simple')
          .send({ name: 'a new name!' })
          .expect(403))));

    it('should update allowed fields', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closing' })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.state.should.equal('closing');
          })
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Form();
              body.state.should.equal('closing');
            })))));

    it('should reject if state is invalid', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ name: 'a cool name', state: 'the coolest' })
          .expect(400))));

    it('should not update disallowed fields', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({
            xmlFormId: 'changed',
            xml: 'changed',
            hash: 'changed',
            name: 'a fancy name'
          })
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.xmlFormId.should.equal('simple');
                body.hash.should.equal('5c09c21d4c71f2f13f6aa26227b2d133');
                body.name.should.equal('Simple');
              }),
            asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(testData.forms.simple);
              })
          ])))));

    it('should log the action in the audit log', testService((service, { Projects, Forms, Users, Audits }) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/simple')
          .send({ state: 'closing' })
          .expect(200)
          .then(() => Promise.all([
            Users.getByEmail('alice@opendatakit.org').then((o) => o.get()),
            Projects.getById(1).then((o) => o.get())
              .then((project) => Forms.getByProjectAndXmlFormId(project.id, 'simple')).then((o) => o.get()),
            Audits.getLatestByAction('form.update').then((o) => o.get())
          ])
          .then(([ alice, form, log ]) => {
            log.actorId.should.equal(alice.actor.id);
            log.acteeId.should.equal(form.acteeId);
            log.details.should.eql({ data: { state: 'closing' } });
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

    it('should log the action in the audit log', testService((service, { Projects, Forms, Users, Audits }) =>
      service.login('alice', (asAlice) =>
        Projects.getById(1).then((o) => o.get())
          .then((project) => Forms.getByProjectAndXmlFormId(project.id, 'simple')).then((o) => o.get())
          .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => Promise.all([
              Users.getByEmail('alice@opendatakit.org').then((o) => o.get()),
              Audits.getLatestByAction('form.delete').then((o) => o.get())
            ])
            .then(([ alice, log ]) => {
              log.actorId.should.equal(alice.actor.id);
              log.acteeId.should.equal(form.acteeId);
            }))))));

    it('should delete all associated assignments', testService((service) =>
      service.login('alice', (asAlice) =>
        Promise.all([
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'test app user' })
            .expect(200)
            .then(({ body }) => body.id),
          asAlice.get('/v1/roles/app-user')
            .expect(200)
            .then(({ body }) => body.id)
        ])
          .then(([ fkId, roleId ]) => asAlice.post(`/v1/projects/1/forms/simple/assignments/${roleId}/${fkId}`)
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/simple')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/assignments/forms/')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([]);
              }))))));
  });

  describe('/deletedForms (listing trashed forms)', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms?deleted=true').expect(403))));
    
    it('should list soft-deleted forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/withrepeat')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms?deleted=true')
            .expect(200)
            .then(({ body }) => {
              should.exist(body[0].deletedAt);
              body.forEach((form) => form.should.be.a.Form());
              body.map((form) => form.id).should.eql([ 2 ]);
              body.map((form) => form.projectId).should.eql([ 1 ]);
              body.map((form) => form.xmlFormId).should.eql([ 'withrepeat' ]);
              body.map((form) => form.name).should.eql([ null ]);
              body.map((form) => form.hash).should.eql([ 'e7e9e6b3f11fca713ff09742f4312029' ]);
              body.map((form) => form.version).should.eql([ '1.0' ]);
            })))));

    it('should list soft-deleted forms including extended metadata and submissions', testService((service) =>
      service.login('alice', (asAlice) =>
         asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms?deleted=true')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                const simple = body.find((form) => form.xmlFormId === 'simple');
                should.exist(simple.deletedAt);
                simple.submissions.should.equal(1);
                simple.lastSubmission.should.be.a.recentIsoDate();
              }))))));

    it('should not include deletedAt form field on regular forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.forEach((form) => form.hasOwnProperty('deletedAt').should.be.false());
          })
          .then(() => asAlice.get('/v1/projects/1/forms')
            .expect(200)
            .then(({ body }) => {
              body.forEach((form) => form.hasOwnProperty('deletedAt').should.be.false());
            })))));
  });

  describe('/:id/restore (undeleting trashed forms)', () => {
    it('should reject restoring unless the user can delete', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.post('/v1/projects/1/forms/1/restore').expect(403))))));

    it('should reject restoring if referenced by the xml form id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/restore')
            .expect(400))))); // bad request

    it('should restore a soft-deleted form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(200)))));

    it('should log form.restore in audit log', testService((service, { Audits, Forms, Users }) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(200))
          .then(() => Promise.all([
            Users.getByEmail('alice@opendatakit.org').then((o) => o.get()),
            Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()),
            Audits.getLatestByAction('form.restore').then((o) => o.get())
          ])
          .then(([ alice, form, log ]) => {
            log.actorId.should.equal(alice.actor.id);
            log.acteeId.should.equal(form.acteeId);
          })))));

    it('should restore a specific form by numeric id when multiple trashed forms share the same xmlFormId', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(200)))));

    it('should fail restoring a form that is not deleted', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/1/restore')
          .expect(404))));

    it('should fail to restore a form when another active form with the same form id exists', testService((service, { Audits }) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/1/restore')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.3);
              body.details.fields.should.eql([ 'projectId', 'xmlFormId' ]);
              body.details.values.should.eql([ '1', 'simple' ]);
            })))));

  });


  ////////////////////////////////////////////////////////////////////////////////
  // DRAFT FORM OPERATIONS
  ////////////////////////////////////////////////////////////////////////////////

  describe('/:id/draft', () => {
    describe('POST', () => {
      // for operations that replicate others above we will not exhaustively test every
      // case here. we mostly check plumbing and differences.

      it('should reject notfound if the form does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/nonexistent/draft').expect(404))));

      it('should reject unless the user may modify the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.post('/v1/projects/1/forms/withAttachments/draft')
                .send(testData.forms.withAttachments)
                .set('Content-Type', 'application/xml')
                .expect(403))))));

      it('should reject if the xmlFormId does not match', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.8);
              body.details.should.eql({
                field: 'xmlFormId',
                value: 'withAttachments',
                reason: 'does not match the form you are updating'
              });
            }))));

      it('should set the draft version', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => {
                body.version.should.equal('drafty');
              })))));

      it('should create a new draft token setting a new draft version', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => {
                const { draftToken } = body;
                draftToken.should.be.a.token();

                return asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
                  .expect(200)
                  .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
                    .expect(200))
                  .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
                    .then(({ body }) => {
                      body.draftToken.should.be.a.token();
                      body.draftToken.should.not.equal(draftToken);
                    }));
              })))));

    it('should worker-process the draft form over to enketo', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(({ body }) => {
            should.not.exist(body.enketoId);
          })
          .then(() => exhaust(container))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(({ body }) => {
              body.enketoId.should.equal('::abcdefgh');
              should.not.exist(body.enketoOnceId);
              global.enketoReceivedUrl.startsWith(container.env.domain).should.equal(true);
              global.enketoReceivedUrl.should.match(/\/v1\/test\/[a-z0-9$!]{64}\/projects\/1\/forms\/simple\/draft/i);
            })))));

    it('should manage draft/published enketo tokens separately', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200)
          .then(() => exhaust(container))
          .then(() => {
            global.enketoToken = '::ijklmnop';
            return asAlice.post('/v1/projects/1/forms/simple2/draft')
              .expect(200)
              .then(() => exhaust(container))
              .then(() => Promise.all([
                asAlice.get('/v1/projects/1/forms/simple2')
                  .expect(200)
                  .then(({ body }) => { body.enketoId.should.equal('::abcdefgh'); }),
                asAlice.get('/v1/projects/1/forms/simple2/draft')
                  .expect(200)
                  .then(({ body }) => { body.enketoId.should.equal('::ijklmnop'); })
              ]));
          }))));

      it('should replace the draft version', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => {
                body.version.should.equal('drafty2');
              })))));

      it('should keep the draft token while replacing the draft version', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => {
                const { draftToken } = body;
                draftToken.should.be.a.token();
                return asAlice.post('/v1/projects/1/forms/simple/draft')
                  .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
                  .set('Content-Type', 'application/xml')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
                    .expect(200)
                    .then(({ body }) => {
                      body.draftToken.should.equal(draftToken);
                    }));
              })))));

      it('should copy the published form definition if not given one', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => {
                body.version.should.equal('');
                body.sha256.should.equal('93fdcefabfe5b6ea49f207e0c6fc8ba72ceb34828bff9c7929ef56eafd2d84cc');
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft.xml')
              .expect(200)
              .then(({ text }) => {
                text.includes('<h:title>Simple</h:title>').should.equal(true);
              })))));

      it('should do nothing given no POST body and no published form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
              .expect(400)
              .then(({ body }) => {
                body.code.should.equal(400.2);
                body.details.should.eql({ field: 'xml' });
              })))));

      it('should accept xlsx drafts', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
              .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
              .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .set('X-XlsForm-FormId-Fallback', 'simple')
              .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft')
                .expect(200)
                .then(({ body }) => {
                  body.version.should.equal('2.1');
                  body.sha256.should.equal('d438bdfb5c0b9bb800420363ca8900d26c3e664945d4ffc41406cbc599e43cae');
                }))))));

      // no strong reason to think we need to test the warnings failure case, but we
      // should verify the plumbing of ignoreWarnings just in case.
      it('should ignore xlsx warnings if asked', testService((service) => {
        global.xlsformTest = 'warning'; // set up the mock service to warn.
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft?ignoreWarnings=true')
              .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
              .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .set('X-XlsForm-FormId-Fallback', 'simple')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft')
                .expect(200)
                .then(({ body }) => {
                  body.version.should.equal('2.1');
                  body.sha256.should.equal('d438bdfb5c0b9bb800420363ca8900d26c3e664945d4ffc41406cbc599e43cae');
                }))));
      }));

      it('should deal with xlsx itemsets', testService((service) => {
        global.xlsformForm = 'itemsets';
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.itemsets)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/itemsets/draft')
              .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
              .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .set('X-XlsForm-FormId-Fallback', 'itemsets'))
            .then(() => asAlice.get('/v1/projects/1/forms/itemsets/draft/attachments/itemsets.csv')
              .expect(200)
              .then(({ text }) => {
                text.should.equal('a,b,c\n1,2,3\n4,5,6');
              })));
      }));

      it('should pick up xlsx itemsets when newly required', testService((service) => {
        global.xlsformForm = 'itemsets';
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simple.replace(/simple/g, 'itemsets'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/itemsets/draft')
              .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
              .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .set('X-XlsForm-FormId-Fallback', 'itemsets'))
            .then(() => asAlice.get('/v1/projects/1/forms/itemsets/draft/attachments/itemsets.csv')
              .expect(200)
              .then(({ text }) => {
                text.should.equal('a,b,c\n1,2,3\n4,5,6');
              })));
      }));

      it('should pick up new xlsx itemsets replacing the old one', testService((service) => {
        global.xlsformForm = 'itemsets';
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.itemsets)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/itemsets/draft/attachments/itemsets.csv')
              .send('x,y,z\n9,8,7\n6,5,4')
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/itemsets/draft')
              .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
              .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .set('X-XlsForm-FormId-Fallback', 'itemsets'))
            .then(() => asAlice.get('/v1/projects/1/forms/itemsets/draft/attachments/itemsets.csv')
              .expect(200)
              .then(({ text }) => {
                text.should.equal('a,b,c\n1,2,3\n4,5,6');
              })));
      }));

      it('should allow version conflicts in draft state', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200))));

      it('should complain about field conflicts', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('type="int"', 'type="date"'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.17);
              body.details.should.eql({ path: '/age', type: 'int' });
            }))));

      it('should complain about field conflicts (older)', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple
              .replace('id="simple"', 'id="simple" version="2"')
              .replace(/age/g, 'number'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('type="int"', 'type="date"'))
              .set('Content-Type', 'application/xml')
              .expect(400)
              .then(({ body }) => {
                body.code.should.equal(400.17);
                body.details.should.eql({ path: '/age', type: 'int' });
              })))));

      it('should not complain on downcast to string', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('type="int"', 'type="string"'))
            .set('Content-Type', 'application/xml')
            .expect(200))));

      it('should complain on upcast from string', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('name" type="string"', 'name" type="int"'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.17);
              body.details.should.eql({ path: '/name', type: 'string' });
            }))));

      it('should not complain on double-downcast to string', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('type="int"', 'type="string"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .expect(200)))));

      it('should complain on upcast once downcasted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('type="int"', 'type="string"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
              .set('Content-Type', 'application/xml')
              .expect(400)
              .then(({ body }) => {
                body.code.should.equal(400.17);
                body.details.should.eql({ path: '/age', type: 'string' });
              })))));

      it.skip('should complain on downcast from group to string', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('nodeset="/data/meta/instanceID"', 'nodeset="/data/meta"'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.17);
              body.details.should.eql({ path: '/meta', type: 'structure' });
            }))));

      it.skip('should complain on downcast from repeat to string', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/withrepeat/draft')
            .send(testData.forms.withrepeat
              .replace('</model>', '<bind nodeset="/data/children/child" type="int"/></model>')
              .replace('<repeat', '<rpt')
              .replace('</repeat', '</rpt'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.17);
              body.details.should.eql({ path: '/children/child', type: 'repeat' });
            }))));

      it('should not complain about discarded draft field conflicts', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace(/age/g, 'number'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace(/age/g, 'number').replace('type="int"', 'type="string"'))
              .set('Content-Type', 'application/xml')
              .expect(200)))));

      it('should identify attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.withAttachments.replace('id="withAttachments"', 'id="simple"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: false },
                  { name: 'goodtwo.mp3', type: 'audio', exists: false }
                ]);
              })))));

      it('should carry forward matching published attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => Promise.all([
              asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('this is goodone.csv')
                .set('Content-Type', 'text/csv')
                .expect(200),
              asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodtwo.mp3')
                .send('this is goodtwo.mp3')
                .set('Content-Type', 'application/octet-stream')
                .expect(200)
            ]))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .send(testData.forms.withAttachments.replace('goodtwo.mp3', 'greattwo.mp3'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
              .expect(200)
              .then(({ body }) => {
                body[0].updatedAt.should.be.a.recentIsoDate();
                delete body[0].updatedAt;
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: true },
                  { name: 'greattwo.mp3', type: 'audio', exists: false }
                ]);
              })))));

      it('should carry forward matching draft attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => Promise.all([
              asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('this is goodone.csv')
                .set('Content-Type', 'text/csv')
                .expect(200),
              asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodtwo.mp3')
                .send('this is goodtwo.mp3')
                .set('Content-Type', 'application/octet-stream')
                .expect(200)
            ]))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .send(testData.forms.withAttachments.replace('goodtwo.mp3', 'greattwo.mp3'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
              .expect(200)
              .then(({ body }) => {
                body[0].updatedAt.should.be.a.recentIsoDate();
                delete body[0].updatedAt;
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: true },
                  { name: 'greattwo.mp3', type: 'audio', exists: false }
                ]);
              })))));

      it('should log the action in the audit log', testService((service, { Forms }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/audits?action=form')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].actorId.should.equal(5);
                body[0].action.should.equal('form.update.draft.set');
                body[0].details.newDraftDefId.should.be.a.Number();

                return Forms.getByProjectAndXmlFormId(1, 'simple')
                  .then((o) => o.get())
                  .then((form) => {
                    form.draftDefId.should.equal(body[0].details.newDraftDefId);
                  });
              })))));

      context('updating form titles', () => {
        const withRenamedTitleAndVersion = (newTitle, newVersion='2.1') => testData.forms.simple2
          .replace('Simple 2', `${newTitle}`).replace('version="2.1"', `version="${newVersion}"`);

        it('should update form title with draft title when no published form exists', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simple2)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                .expect(200)
                .then(({ body }) => {
                  body.name.should.equal('Simple 2');
                })
                .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                  .send(withRenamedTitleAndVersion('New Title'))
                  .set('Content-Type', 'application/xml')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                    .expect(200)
                    .then(({ body }) => {
                      body.name.should.equal('New Title');
                    })
                ))))));

        it('should not update form title with draft title when form already published', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simple2)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                .expect(200)
                .then(({ body }) => {
                  body.name.should.equal('Simple 2');
                })
                .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                  .send(withRenamedTitleAndVersion('New Title'))
                  .set('Content-Type', 'application/xml')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                    .expect(200)
                    .then(({ body }) => {
                      body.name.should.equal('Simple 2');
                    })
                ))))));

        it('should not update form title from draft when form published and existing draft present', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simple2)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                .expect(200)
                .then(({ body }) => {
                  body.name.should.equal('Simple 2');
                })
                .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                  .send(withRenamedTitleAndVersion('New Title', '2.2'))
                  .set('Content-Type', 'application/xml')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                    .expect(200)
                    .then(({ body }) => {
                          body.name.should.equal('Simple 2');
                    })
                    .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                      .send(withRenamedTitleAndVersion('An Even Newer Title', '2.3'))
                      .set('Content-Type', 'application/xml')
                      .expect(200)
                      .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                        .expect(200)
                        .then(({ body }) => {
                          body.name.should.equal('Simple 2');
                        })))))))));

        it('should update form title with latest draft title only on publish', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simple2)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                .expect(200)
                .then(({ body }) => {
                  body.name.should.equal('Simple 2');
                })
                .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                  .send(withRenamedTitleAndVersion('New Title', '2.2'))
                  .set('Content-Type', 'application/xml')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                    .expect(200)
                    .then(({ body }) => {
                      body.name.should.equal('Simple 2');
                    })
                    .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
                      .expect(200)
                      .then(() => asAlice.get('/v1/projects/1/forms/simple2')
                        .expect(200)
                        .then(({ body }) => {
                          body.name.should.equal('New Title');
                        })))))))));
      });
    });

    describe('GET', () => {
      it('should return notfound if there is no draft', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/simple/draft')
            .expect(404)
            .then(({ body }) => {
              should.not.exist(body.details);
            }))));

      it('should reject if the user cannot modify', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simple/draft')
                .expect(403))))));

      it('should give basic draft details', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => {
                body.version.should.equal('');
                body.sha256.should.equal('93fdcefabfe5b6ea49f207e0c6fc8ba72ceb34828bff9c7929ef56eafd2d84cc');
                body.draftToken.should.be.a.token();
              })))));

      it('should give extended draft details', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.should.be.an.ExtendedForm();
                body.submissions.should.equal(1);
                body.lastSubmission.should.be.a.recentIsoDate();
              })))));

    it('should return the correct enketoId with extended draft', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200)
          .then(() => exhaust(container))
          .then(() => {
            global.enketoToken = '::ijklmnop';
            return asAlice.post('/v1/projects/1/forms/simple2/draft')
              .expect(200)
              .then(() => exhaust(container))
              .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft')
                .set('X-Extended-Metadata', true)
                .expect(200)
                .then(({ body }) => { body.enketoId.should.equal('::ijklmnop'); }));
          }))));

      it('should not count nondraft submissions in its count', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.submissions.should.equal(0);
              })))));
    });

    describe('DELETE', () => {
      it('should return notfound if there is no draft', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/projects/1/forms/simple/draft')
            .expect(404))));

      it('should reject if the user cannot modify', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.delete('/v1/projects/1/forms/simple/draft')
                .expect(403))))));

      it('should delete the draft without deleting the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/simple/draft')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(404))
            .then(() => asAlice.get('/v1/projects/1/forms/simple')
              .expect(200)
              .then(({ body }) => {
                body.xmlFormId.should.equal('simple');
                body.version.should.equal('');
              })))));

      it('should conflict if there is no published version', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/simple2/draft')
              .expect(409))
              .then(({ body }) => {
                body.code.should.equal(409.7);
              }))));

      it('should create a new draft token after delete', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => {
                const { draftToken } = body;
                draftToken.should.be.a.token();

                return asAlice.delete('/v1/projects/1/forms/simple/draft')
                  .expect(200)
                  .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
                    .expect(200))
                  .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
                    .then(({ body }) => {
                      body.draftToken.should.be.a.token();
                      body.draftToken.should.not.equal(draftToken);
                    }));
              })))));

      it('should log the action in the audit log', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/simple/draft')
              .expect(200))
            .then(() => asAlice.get('/v1/audits?action=form')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(2);
                body.map((audit) => audit.actorId).should.eql([ 5, 5 ]);
                body.map((audit) => audit.action).should.eql([ 'form.update.draft.delete', 'form.update.draft.set' ]);
                body[0].details.oldDraftDefId.should.equal(body[1].details.newDraftDefId);
                body[0].details.oldDraftDefId.should.be.a.Number();
              })))));
    });

    describe('/publish POST', () => {
      it('should return notfound if there is no draft', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft/publish')
            .expect(404))));

      it('should reject if the user cannot modify', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.post('/v1/projects/1/forms/simple/draft/publish')
                .expect(403))))));

      it('should reject if the version conflicts', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(409)
              .then(({ body }) => {
                body.code.should.equal(409.6);
                body.details.should.eql({ xmlFormId: 'simple', version: '' });
              })))));

      it('should set version on the fly if requested', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=new')
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simple')
                .expect(200)
                .then(({ body }) => {
                  body.version.should.equal('new');
                  body.sha256.should.equal('f073fe9062e0ca4d6337b96b93e0100164a40e16df5f477d065b33470acabc44');
                }))))));

      it('should succeed and set the publish date', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple')
              .expect(200)
              .then(({ body }) => {
                body.version.should.equal('2');
                body.sha256.should.equal('c01ab93518276534e72307afed190efe15974db8a9d9ffe2ba8ddf663c932271');
              })))));

      it('should not have a draft afterwards', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(404)))));

      it('should show the published versions at /versions', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/versions/___')
              .expect(200)
              .then(({ body }) => {
                body.version.should.equal('');
                body.sha256.should.equal('93fdcefabfe5b6ea49f207e0c6fc8ba72ceb34828bff9c7929ef56eafd2d84cc');
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/versions/2')
              .expect(200)
              .then(({ body }) => {
                body.version.should.equal('2');
                body.sha256.should.equal('c01ab93518276534e72307afed190efe15974db8a9d9ffe2ba8ddf663c932271');
              })))));

      it('should provide attachments as expected', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('this is goodone.csv')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
              .expect(200)
              .then(({ body }) => {
                body[0].updatedAt.should.be.a.recentIsoDate();
                delete body[0].updatedAt;
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: true },
                  { name: 'goodtwo.mp3', type: 'audio', exists: false }
                ]);
              })))));

      it('should log the action in the audit log', testService((service, { Forms }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=new')
              .expect(200))
            .then(() => asAlice.get('/v1/audits?action=form')
              .expect(200)
              .then(({ body }) => {
                // TODO:
                // so, it can happen that this operation proceeds quickly enough that the
                // intermediate draftset and the publish audit logs record exactly the same
                // timestamp, and in that case they will select back out of the database
                // in reverse.
                //
                // this isn't amazing but i'm not sure it's a significant enough problem to
                // solve; really it's just annoying because it makes this test unstable.
                // so we just detect that case specifically and invert the first two results
                // if we see the issue.

                if (body[0].action === 'form.update.draft.set')
                  [ body[1], body[0] ] = [ body[0], body[1] ];

                body.length.should.equal(3);
                body.map((audit) => audit.actorId).should.eql([ 5, 5, 5 ]);
                body.map((audit) => audit.action).should.eql([ 'form.update.publish', 'form.update.draft.set', 'form.update.draft.set' ]);
                body[0].details.newDefId.should.be.a.Number();
                body[0].details.oldDefId.should.be.a.Number();
                body[0].details.newDefId.should.not.equal(body[0].details.oldDefId);
                //body[1].details.automated.should.equal(true); // TODO/SL is this a big deal?

                body[0].details.newDefId.should.equal(body[1].details.newDraftDefId);

                return Forms.getByProjectAndXmlFormId(1, 'simple')
                  .then((o) => o.get())
                  .then((form) => {
                    body[1].details.newDraftDefId.should.equal(form.currentDefId);
                  });
              })))));
    });

    describe('/fields GET', () => {
      it('should return fields', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/fields')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { path: '/meta', name: 'meta', type: 'structure', binary: null, selectMultiple: null },
                  { path: '/meta/instanceID', name: 'instanceID', type: 'string', binary: null, selectMultiple: null },
                  { path: '/name', name: 'name', type: 'string', binary: null, selectMultiple: null },
                  { path: '/age', name: 'age', type: 'int', binary: null, selectMultiple: null }
                ]);
              })))));
    });

    describe('/manifest GET', () => {
      it('should return a manifest', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('this is goodone.csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft/manifest')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                text.includes('<hash>md5:2af2751b79eccfaa8f452331e76e679e</hash>').should.equal(true);
              })))));
    });

    describe('/attachments', () => {
      // we use the attachments read endpoints here to test the write ones so we don't
      // bother with testing them separately.

      describe('/:name POST', () => {
        it('should reject notfound if the draft does not exist', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
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
                asChelsea.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                  .send('test,csv\n1,2')
                  .set('Content-Type', 'text/csv')
                  .expect(403))))));

        it('should accept the file with a success result', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(({ body }) => {
                  body.should.eql({ success: true });
                })))));

        it('should accept xml type files', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/xml')
                .expect(200)
                .then(({ body }) => {
                  body.should.eql({ success: true });
                }))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .expect(200)
                .then(({ headers, text }) => {
                  headers['content-type'].should.startWith('text/xml');
                  text.should.equal('test,csv\n1,2');
                })))));

        it('should replace an extant file with another', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                  .send('replaced,csv\n3,4')
                  .set('Content-Type', 'text/csv')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
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
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodtwo.mp3')
                  .send('test,csv\n1,2')
                  .set('Content-Type', 'text/csv')
                  .expect(200))))));

        it('should log the action in the audit log', testService((service, { Projects, Forms, FormAttachments, Users, Audits }) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(() => Promise.all([
                  Users.getByEmail('alice@opendatakit.org').then((o) => o.get()),
                  Projects.getById(1).then((o) => o.get())
                    .then((project) => Forms.getByProjectAndXmlFormId(project.id, 'withAttachments')).then((o) => o.get())
                    .then((form) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv')
                      .then((o) => o.get())
                      .then((attachment) => [ form, attachment ])),
                  Audits.getLatestByAction('form.attachment.update').then((o) => o.get())
                ])
                .then(([ alice, [ form, attachment ], log ]) => {
                  log.actorId.should.equal(alice.actor.id);
                  log.acteeId.should.equal(form.acteeId);
                  log.details.should.eql({
                    formDefId: form.draftDefId,
                    name: attachment.name,
                    oldBlobId: null,
                    newBlobId: attachment.blobId
                  });

                  return asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                    .send('replaced,csv\n3,4')
                    .set('Content-Type', 'text/csv')
                    .expect(200)
                    .then(() => Promise.all([
                      FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv').then((o) => o.get()),
                      Audits.getLatestByAction('form.attachment.update').then((o) => o.get())
                    ]))
                    .then(([ attachment2, log2 ]) => {
                      log2.actorId.should.equal(alice.actor.id);
                      log2.acteeId.should.equal(form.acteeId);
                      log2.details.should.eql({
                        formDefId: form.draftDefId,
                        name: attachment.name,
                        oldBlobId: attachment.blobId,
                        newBlobId: attachment2.blobId
                      });
                    });
                }))))));
      });

      // these tests mostly necessarily depend on /:name POST:
      describe('/:name DELETE', () => {
        it('should reject notfound if the draft does not exist', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .expect(404))));

        it('should reject unless the user may update the form', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(() => service.login('chelsea', (asChelsea) =>
                  asChelsea.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                  .expect(403)))))));

        it('should reject notfound if the file does not exist', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .expect(404)))));

        it('should delete the attachment contents', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(() => asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                  .expect(200)
                  .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                    .expect(404)))))));

        it('should log the action in the audit log', testService((service, { Projects, Forms, FormAttachments, Users, Audits }) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('test,csv\n1,2')
                .set('Content-Type', 'text/csv')
                .expect(200)
                .then(() => Promise.all([
                  Users.getByEmail('alice@opendatakit.org').then((o) => o.get()),
                  Projects.getById(1).then((o) => o.get())
                    .then((project) => Forms.getByProjectAndXmlFormId(project.id, 'withAttachments'))
                    .then((o) => o.get())
                    .then((form) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv')
                      .then((o) => o.get())
                      .then((attachment) => [ form, attachment ]))
                ]))
                .then(([ alice, [ form, attachment ] ]) =>
                  asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                    .expect(200)
                    .then(() => Audits.getLatestByAction('form.attachment.update').then((o) => o.get()))
                    .then((log) => {
                      log.actorId.should.equal(alice.actor.id);
                      log.acteeId.should.equal(form.acteeId);
                      log.details.should.eql({
                        formDefId: form.draftDefId,
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

  describe('/:id/versions', () => {
    // for operations that replicate others above we will not exhaustively test every
    // case here. we mostly check plumbing and differences.

    describe('GET', () => {
      it('should return notfound if the form does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/nonexistent/versions')
            .expect(404))));

      it('should reject if the user cannot read', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/projects/1/forms/simple/versions')
            .expect(403))));

      it('should list all versions', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/versions')
              .expect(200)
              .then(({ body }) => {
                body.map((form) => form.version).should.eql([ '3', '2', '' ]);
                body.map((form) => form.sha256).should.eql([
                  'fdfcb6484a2086c8ef64edd578168734866babb4743dcee127277990e7c5e04f',
                  'c01ab93518276534e72307afed190efe15974db8a9d9ffe2ba8ddf663c932271',
                  '93fdcefabfe5b6ea49f207e0c6fc8ba72ceb34828bff9c7929ef56eafd2d84cc'
                ]);
                body.map((form) => form.xmlFormId).should.eql([ 'simple', 'simple', 'simple' ]);
              })))));

      it('should not list draft or orphan versions', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/versions')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].version.should.equal('');
                body[0].sha256.should.equal('93fdcefabfe5b6ea49f207e0c6fc8ba72ceb34828bff9c7929ef56eafd2d84cc');
              })))));

      it('should not list any versions if none are published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/versions')
              .expect(200)
              .then(({ body }) => { body.should.eql([]); }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/versions')
              .set('X-Extended-Metadata', true)
              .expect(200)
              .then(({ body }) => { body.should.eql([]); })))));

      it('should not give an enketoId', testService((service, container) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.simple2)
            .expect(200)
            .then(() => exhaust(container))
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish?version=3')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/versions')
              .expect(200)
              .then(({ body }) => {
                body.map((f) => f.version).should.eql([ '3', '2.1' ]);
                body.map((f) => f.enketoId).should.eql([ '::abcdefgh', null ]);
                body.map((f) => f.enketoOnceId).should.eql([ '::::abcdefgh', null ]);
              })))));

      it('should return publishedBy if extended is requested', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/versions')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body[0].publishedBy.should.be.an.Actor();
                body[0].publishedBy.displayName.should.equal('Alice');
                body[1].publishedBy.should.be.an.Actor();
                body[1].publishedBy.displayName.should.equal('Alice');
                should.not.exist(body[2].publishedBy);
              })))));

      it('should return xls content type with extended form details', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
            .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .set('X-XlsForm-FormId-Fallback', 'testformid')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
              .send(testData.forms.simple2.replace('id="simple2"', 'id="simple2" version="3"'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/versions')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.map((form) => form.excelContentType).should.eql([
                  null,
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                ]);
              })))));

      it('should not give an enketoId with extended details', testService((service, container) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.simple2)
            .expect(200)
            .then(() => exhaust(container))
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish?version=3')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/versions')
              .set('X-Extended-Metadata', true)
              .expect(200)
              .then(({ body }) => {
                body.map((f) => f.version).should.eql([ '3', '2.1' ]);
                body.map((f) => f.enketoId).should.eql([ '::abcdefgh', null ]);
              })))));

      it('should sort results desc by publishedAt', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/versions')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.map((version) => version.version).should.eql([ '2', '3', '' ]);
              })))));
    });

    describe('/:version', () => {
      describe('GET', () => {
        it('should reject if the version does not exist', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/projects/1/forms/simple/versions/hello')
              .expect(404))));

        it('should reject if the user cannot read', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
                .expect(200))
              .then(() => service.login('chelsea', (asChelsea) =>
                asChelsea.get('/v1/projects/1/forms/simple/versions/___')
                  .expect(403))))));

        it('should return basic details', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
                .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simple/versions/2')
                .expect(200)
                .then(({ body }) => {
                  body.version.should.equal('2');
                  body.sha256.should.equal('c01ab93518276534e72307afed190efe15974db8a9d9ffe2ba8ddf663c932271');
                })))));

        it('should look for empty string given ___', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simple/versions/___')
                .expect(200)
                .then(({ body }) => {
                  body.version.should.equal('');
                  body.sha256.should.equal('93fdcefabfe5b6ea49f207e0c6fc8ba72ceb34828bff9c7929ef56eafd2d84cc');
                })))));
      });

      describe('.xlsx GET', () => {
        // look, we'll just test xlsx and trust that xls works.

        it('should return the xlsx file originally provided', testService((service) => {
          const input = readFileSync(appRoot + '/test/data/simple.xlsx');
          return service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(input)
              .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                .send(testData.forms.simple2.replace('version="2.1"', 'version="3"'))
                .set('Content-Type', 'text/xml')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simple2/versions/2.1.xlsx')
                .buffer(true).parse(superagent.parse['application/octet-stream'])
                .then(({ headers, body }) => {
                  headers['content-type'].should.equal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                  headers['content-disposition'].should.equal('attachment; filename="simple2.xlsx"; filename*=UTF-8\'\'simple2.xlsx');
                  Buffer.compare(input, body).should.equal(0);
                })));
        }));
      });

      describe('/fields GET', () => {
        it('should return a list of fields', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simple/versions/___/fields')
                .expect(200)
                .then(({ body }) => {
                  body.should.eql([
                    { name: 'meta', path: '/meta', type: 'structure', binary: null, selectMultiple: null },
                    { name: 'instanceID', path: '/meta/instanceID', type: 'string', binary: null, selectMultiple: null },
                    { name: 'name', path: '/name', type: 'string', binary: null, selectMultiple: null },
                    { name: 'age', path: '/age', type: 'int', binary: null, selectMultiple: null }
                  ]);
                })))));
      });

      describe('/manifest GET', () => {
        it('should return a manifest', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('this is goodone.csv')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
                .send(testData.forms.withAttachments
                  .replace('id="withAttachments"', 'id="withAttachments" version="2"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/versions/___/manifest')
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  text.includes('<hash>md5:2af2751b79eccfaa8f452331e76e679e</hash>').should.equal(true);
                })))));
      });

      describe('/attachments', () => {
        it('should return a list of attachments', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('this is goodone.csv')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
                .send(testData.forms.withAttachments
                  .replace('id="withAttachments"', 'id="withAttachments" version="2"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/versions/___/attachments')
                .expect(200)
                .then(({ body }) => {
                  body[0].updatedAt.should.be.a.recentIsoDate();
                  delete body[0].updatedAt;

                  body.should.eql([
                    { name: 'goodone.csv', type: 'file', exists: true },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false }
                  ])
                })))));

        it('should return an attachment', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send('this is goodone.csv')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
                .send(testData.forms.withAttachments
                  .replace('id="withAttachments"', 'id="withAttachments" version="2"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/versions/___/attachments/goodone.csv')
                .expect(200)
                .then(({ text }) => {
                  text.should.equal('this is goodone.csv');
                })))));
      });
    });
  });


  ////////////////////////////////////////////////////////////////////////////////
  // DRAFT FORM TESTING
  ////////////////////////////////////////////////////////////////////////////////

  describe('/test/:key/…/:id/draft', () => {
    describe('/formList GET', () => {
      it('should reject if the draft does not exist', testService((service) =>
        service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/formList')
          .set('X-OpenRosa-Version', '1.0')
          .expect(404)));

      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject after publish with a custom error message', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)
                  .then(({ text }) => {
                    text.should.match(/You tried to access a draft testing endpoint, but it does not exist anymore or your access is no longer valid\./);
                  })))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.delete('/v1/projects/1/forms/simple/draft')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/formList')
              .set('X-OpenRosa-Version', '1.0')
              .expect(404)
              .then(({ text }) => {
                text.should.match(/You tried to access a draft testing endpoint, but it does not exist anymore or your access is no longer valid\./);
              })))));

      it('should reject on incorrect key with a custom error message', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/formList')
              .set('X-OpenRosa-Version', '1.0')
              .expect(404)))));

      it('should give an appropriate formList', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
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
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/simple/draft.xml</downloadUrl>
    </xform>
  </xforms>`);
                }))))));

      it('should include a manifest node for forms with attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/formList`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>withAttachments</formID>
      <name>withAttachments</name>
      <version></version>
      <hash>md5:7eb21b5b123b0badcf2b8f50bcf1cbd0</hash>
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/withAttachments/draft.xml</downloadUrl>
      <manifestUrl>${domain}/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest</manifestUrl>
    </xform>
  </xforms>`);
              }))))));
    });

    describe('/manifest GET', () => {
      it('should reject if the draft does not exist', testService((service) =>
        service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(404)));

      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.delete('/v1/projects/1/forms/withAttachments/draft')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/withAttachments/draft/manifest')
                .set('X-OpenRosa-Version', '1.0')
                .expect(404))))));

      it('should return an empty manifest if the draft has no attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/manifest`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
                }))))));

      it('should return a manifest with present attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile>
      <filename>goodone.csv</filename>
      <hash>md5:2241de57bbec8144c8ad387e69b3a3ba</hash>
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv</downloadUrl>
    </mediaFile>
  </manifest>`);
                }))))));
    });

    describe('.xml GET', () => {
      it('should reject if the draft does not exist', testService((service) =>
        service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft.xml')
          .set('X-OpenRosa-Version', '1.0')
          .expect(404)));

      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft.xml`)
                  .expect(404)))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200))
            .then(({ body }) => body.draftToken)
            .then((token) => asAlice.delete('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft.xml`)
                .expect(404))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft.xml')
              .set('X-OpenRosa-Version', '1.0')
              .expect(404)))));

      it('should give the xml', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/simple/draft.xml`)
                .expect(200)
                .then(({ text }) => { text.should.equal(testData.forms.simple); }))))));
    });

    describe('/attachments/:name GET', () => {
      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
                  .expect(404)))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.delete('/v1/projects/1/forms/withAttachments/draft')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
                  .expect(404)))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .expect(404)))));

      it('should return the attachment', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
                .expect(200)
                .then(({ text }) => { text.should.equal('test,csv\n1,2'); }))))));
    });
  });
});

