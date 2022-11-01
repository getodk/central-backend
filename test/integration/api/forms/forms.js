const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const superagent = require('superagent');
const { DateTime } = require('luxon');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('api: /projects/:id/forms (create, read, update)', () => {

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
            .send({ passphrase: 'supersecret' })
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
                    { name: 'goodone.csv', type: 'file', exists: false, blobExists: false, datasetExists: false },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false }
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
                  // eslint-disable-next-line no-param-reassign
                  delete body[0].updatedAt;

                  body.should.eql([
                    { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false }
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
            Users.getByEmail('alice@getodk.org').then((o) => o.get()),
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
});
