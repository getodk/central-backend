const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const superagent = require('superagent');
const { DateTime } = require('luxon');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');
const { exhaust } = require(appRoot + '/lib/worker/worker');
const { omit } = require(appRoot + '/lib/util/util');

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
          .then(() => asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(409)
            .then(({ body }) => {
              body.message.should.eql("You tried to publish the form 'simple' with version '', but a published form has already existed in this project with those identifiers.");
              body.details.should.eql({ xmlFormId: 'simple', version: '' });
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
            body.details.warnings.xlsFormWarnings.should.eql([ 'warning 1', 'warning 2' ]);
          }));
    }));

    it('should fail on warnings even for valid xlsx files', testService(async (service) => {
      await service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(200));

      global.xlsformTest = 'warning'; // set up the mock service to warn.
      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple2/draft')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.16);
            body.details.warnings.xlsFormWarnings.should.eql([ 'warning 1', 'warning 2' ]);
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
              body.publishedAt.should.eql(body.createdAt);
              (body.updatedAt == null).should.equal(true);
            })
            .then(() => asAlice.get('/v1/audits?action=form')
              .expect(200)
              .then(({ body }) => {
                body.map((a) => a.action).should.eql(['form.update.publish', 'form.create']);
              }))))));

    it('should have published timestamp different from create timestamp if published separately', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2')
            .expect(200)
            .then(({ body }) => {
              body.publishedAt.should.be.a.recentIsoDate();
              body.publishedAt.should.not.eql(body.createdAt);
              body.updatedAt.should.be.a.recentIsoDate();
            })
            .then(() => asAlice.get('/v1/audits?action=form')
              .expect(200)
              .then(({ body }) => {
                body.map((a) => a.action).should.eql(['form.update.publish', 'form.create']);
              }))))));

    describe('Enketo ID for draft', () => {
      it('should request an enketoId', testService(async (service, { env }) => {
        const asAlice = await service.login('alice');
        const { body } = await asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        global.enketo.callCount.should.equal(1);
        global.enketo.createData.should.eql({
          openRosaUrl: `${env.domain}/v1/test/${body.draftToken}/projects/1/forms/simple2/draft`,
          xmlFormId: 'simple2',
          token: undefined
        });
        body.enketoId.should.equal('::abcdefgh');
        should.not.exist(body.enketoOnceId);
      }));

      it('should return with success even if request to Enketo fails', testService(async (service) => {
        const asAlice = await service.login('alice');
        global.enketo.state = 'error';
        const { body } = await asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        should.not.exist(body.enketoId);
        should.not.exist(body.enketoOnceId);
      }));

      it('should wait for Enketo only briefly @slow', testService(async (service) => {
        const asAlice = await service.login('alice');
        global.enketo.wait = (done) => { setTimeout(done, 600); };
        const { body } = await asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        should.not.exist(body.enketoId);
        should.not.exist(body.enketoOnceId);
      }));

      it('should request an enketoId from worker if request from endpoint fails', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // First request to Enketo, from the endpoint
        global.enketo.state = 'error';
        await asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);

        // Second request, from the worker
        global.enketo.callCount.should.equal(1);
        await exhaust(container);
        global.enketo.callCount.should.equal(2);
        const { body } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        global.enketo.createData.should.eql({
          openRosaUrl: `${container.env.domain}/v1/test/${body.draftToken}/projects/1/forms/simple2/draft`,
          xmlFormId: 'simple2',
          token: undefined
        });
        body.enketoId.should.equal('::abcdefgh');
        should.not.exist(body.enketoOnceId);
      }));

      it('should not request an enketoId from worker if request from endpoint succeeds', testService(async (service, container) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        global.enketo.callCount.should.equal(1);
        await exhaust(container);
        global.enketo.callCount.should.equal(1);
      }));
    });

    describe('Enketo IDs for published form', () => {
      it('should request Enketo IDs', testService(async (service, { env }) => {
        const asAlice = await service.login('alice');
        const { body } = await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        // This will make a published enketo token and a draft token even though the draft is not used
        global.enketo.callCount.should.equal(2);
        omit(['token'], global.enketo.createData).should.eql({
          openRosaUrl: `${env.domain}/v1/projects/1`,
          xmlFormId: 'simple2'
        });
        body.enketoId.should.equal('::abcdefgh');
        body.enketoOnceId.should.equal('::::abcdefgh');
      }));

      it('should return with success even if request to Enketo fails', testService(async (service) => {
        const asAlice = await service.login('alice');
        global.enketo.state = 'error';
        global.enketo.autoReset = false;
        const { body } = await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        should.not.exist(body.enketoId);
        should.not.exist(body.enketoOnceId);
      }));

      it('should wait for Enketo only briefly @slow', testService(async (service) => {
        const asAlice = await service.login('alice');
        global.enketo.wait = (done) => { setTimeout(done, 600); };
        global.enketo.autoReset = false;
        const { body } = await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        should.not.exist(body.enketoId);
        should.not.exist(body.enketoOnceId);
      }));

      it('should wait for published Enketo only briefly @slow', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        global.enketo.wait = (done) => { setTimeout(done, 600); };
        const { body } = await asAlice.post('/v1/projects/1/forms/simple2/draft/publish');
        should.not.exist(body.enketoId);
        should.not.exist(body.enketoOnceId);
      }));

      it('should request Enketo IDs from worker if request from endpoint fails', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // First request to Enketo, from the endpoint
        global.enketo.state = 'error';
        global.enketo.autoReset = false;
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);

        // reset enketo mock to its default behavior
        // also resets callCount
        global.enketo.reset();

        // Second request, from the worker
        await exhaust(container);
        global.enketo.callCount.should.equal(1);
        const { body } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        omit(['token'], global.enketo.createData).should.eql({
          openRosaUrl: `${container.env.domain}/v1/projects/1`,
          xmlFormId: 'simple2'
        });
        body.enketoId.should.equal('::abcdefgh');
        body.enketoOnceId.should.equal('::::abcdefgh');
      }));

      it('should not request Enketo IDs from worker if request from endpoint succeeds', testService(async (service, container) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200);
        global.enketo.callCount.should.equal(2);
        await exhaust(container);
        global.enketo.callCount.should.equal(2);
      }));
    });

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

    it('should reject with deleted form exists warning', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simple)
        .set('Content-Type', 'application/xml')
        .expect(400)
        .then(({ body }) => {
          body.code.should.be.eql(400.16);
          body.details.warnings.workflowWarnings[0].should.be.eql({ type: 'deletedFormExists', details: { xmlFormId: 'simple' } });
        });
    }));

    it('should reject with xls and deleted form exists warnings', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simple2)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simple2')
        .expect(200);

      global.xlsformTest = 'warning'; // set up the mock service to warn.

      await asAlice.post('/v1/projects/1/forms')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .expect(400)
        .then(({ body }) => {
          body.code.should.be.eql(400.16);
          body.details.warnings.xlsFormWarnings.should.be.eql(['warning 1', 'warning 2']);
          body.details.warnings.workflowWarnings[0].should.be.eql({ type: 'deletedFormExists', details: { xmlFormId: 'simple2' } });
        });
    }));

    it('should reject with structure changed warning', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft')
        .send(testData.forms.simple.replace(/age/g, 'address'))
        .set('Content-Type', 'application/xml')
        .then(({ body }) => {
          body.code.should.be.eql(400.16);
          body.details.warnings.workflowWarnings[0].should.be.eql({ type: 'structureChanged', details: [ 'age' ] });
        });
    }));

    it('should reject with structure changed warning', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
        .send(testData.forms.simple.replace(/age/g, 'address'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/draft/publish?ignoreWarnings=true&version=v2')
        .expect(200);
    }));

    it('should reject with xls and structure changed warnings', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simple2.replace(/age/g, 'address'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      global.xlsformTest = 'warning'; // set up the mock service to warn.

      await asAlice.post('/v1/projects/1/forms/simple2/draft')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .expect(400)
        .then(({ body }) => {
          body.code.should.be.eql(400.16);
          body.details.warnings.xlsFormWarnings.should.be.eql(['warning 1', 'warning 2']);
          body.details.warnings.workflowWarnings[0].should.be.eql({ type: 'structureChanged', details: [ 'address' ] });
        });
    }));

    it('should reject form with missing meta group', testService(async (service) => {
      const asAlice = await service.login('alice');

      const missingMeta = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
      <h:head>
        <h:title>Missing Meta</h:title>
        <model>
          <instance>
            <data id="missingMeta">
              <name/>
              <age/>
            </data>
          </instance>
          <bind nodeset="/data/name" type="string"/>
          <bind nodeset="/data/age" type="int"/>
        </model>
      </h:head>

    </h:html>`;

      await asAlice.post('/v1/projects/1/forms')
        .send(missingMeta)
        .set('Content-Type', 'application/xml')
        .expect(400);
    }));

    it('should reject form with meta field that is not a group', testService(async (service) => {
      const asAlice = await service.login('alice');

      const missingMeta = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
      <h:head>
        <h:title>Non Group Meta</h:title>
        <model>
          <instance>
            <data id="missingMeta">
              <meta/>
              <name/>
              <age/>
            </data>
          </instance>
          <bind nodeset="/data/name" type="string"/>
          <bind nodeset="/data/age" type="int"/>
        </model>
      </h:head>

    </h:html>`;

      await asAlice.post('/v1/projects/1/forms')
        .send(missingMeta)
        .set('Content-Type', 'application/xml')
        .expect(400);
    }));

    it('should create the form for xml files with warnings given ignoreWarnings', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simple2)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simple2')
        .expect(200);

      global.xlsformTest = 'warning'; // set up the mock service to warn.

      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .expect(200);
    }));
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
                headers['etag'].should.equal('"30fdb0e9115ea7ca6702573f521814d1"'); // eslint-disable-line dot-notation
                Buffer.compare(input, body).should.equal(0);
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
              .set('If-None-Match', '"30fdb0e9115ea7ca6702573f521814d1"')
              .expect(304)));
      }));

      it('should return s3 redirect after xlsx file uploaded to s3', testService((service, { Blobs }) => {
        global.s3.enableMock();
        const input = readFileSync(appRoot + '/test/data/simple.xlsx');
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(input)
            .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
              .set('If-None-Match', '"30fdb0e9115ea7ca6702573f521814d1"')
              .expect(304))
            .then(() => Blobs.s3UploadPending()
              .then(() => {
                global.s3.uploads.attempted.should.equal(1);
                global.s3.uploads.successful.should.equal(1);
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
              .expect(307)
              .then(({ headers }) => {
                headers.location.should.equal('s3://mock/30fdb0e9115ea7ca6702573f521814d1/9ebd53024b8560ffd0b84763481ed24159ca600f/simple2.xlsx?contentType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx')
              .set('If-None-Match', '"30fdb0e9115ea7ca6702573f521814d1"')
              .expect(307)
              .then(({ headers }) => {
                headers.location.should.equal('s3://mock/30fdb0e9115ea7ca6702573f521814d1/9ebd53024b8560ffd0b84763481ed24159ca600f/simple2.xlsx?contentType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              })));
      }));

      it('should return the xlsx file originally provided for a draft', testService((service) => {
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
                headers['etag'].should.equal('"30fdb0e9115ea7ca6702573f521814d1"'); // eslint-disable-line dot-notation
                Buffer.compare(input, body).should.equal(0);
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft.xlsx')
              .set('If-None-Match', '"30fdb0e9115ea7ca6702573f521814d1"')
              .expect(304)));
      }));

      it('should return s3 redirect after xlsx file for draft uploaded to s3', testService((service, { Blobs }) => {
        global.s3.enableMock();
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
              .set('If-None-Match', '"30fdb0e9115ea7ca6702573f521814d1"')
              .expect(304))
            .then(() => Blobs.s3UploadPending()
              .then(() => {
                global.s3.uploads.attempted.should.equal(1);
                global.s3.uploads.successful.should.equal(1);
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft.xlsx')
              .expect(307)
              .then(({ headers }) => {
                headers.location.should.equal('s3://mock/30fdb0e9115ea7ca6702573f521814d1/9ebd53024b8560ffd0b84763481ed24159ca600f/simple2.xlsx?contentType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft.xlsx')
              .set('If-None-Match', '"30fdb0e9115ea7ca6702573f521814d1"')
              .expect(307)
              .then(({ headers }) => {
                headers.location.should.equal('s3://mock/30fdb0e9115ea7ca6702573f521814d1/9ebd53024b8560ffd0b84763481ed24159ca600f/simple2.xlsx?contentType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xls')
              .expect(200)
              .then(({ headers }) => {
                headers['etag'].should.equal('"30fdb0e9115ea7ca6702573f521814d1"'); // eslint-disable-line dot-notation
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xlsx').expect(404))
            .then(() => asAlice.get('/v1/projects/1/forms/simple2.xls')
              .set('If-None-Match', '"30fdb0e9115ea7ca6702573f521814d1"')
              .expect(304)))));
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

      it('should return count of public links with extended metadata', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'link1' })
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'link2' })
          .expect(200);
        const { body: form } = await asAlice.get('/v1/projects/1/forms/simple')
          .set('X-Extended-Metadata', 'true')
          .expect(200);
        form.publicLinks.should.equal(2);
      }));

      it('should exclude deleted and revoked public links', testService(async (service) => {
        const asAlice = await service.login('alice');
        const { body: link1 } = await asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'link1' })
          .expect(200);
        const { body: link2 } = await asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'link2' })
          .expect(200);
        await asAlice.delete(`/v1/projects/1/forms/simple/public-links/${link1.id}`)
          .expect(200);
        await asAlice.delete(`/v1/sessions/${link2.token}`)
          .expect(200);
        const { body: form } = await asAlice.get('/v1/projects/1/forms/simple')
          .set('X-Extended-Metadata', 'true')
          .expect(200);
        form.publicLinks.should.equal(0);
      }));

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

      it('should return the correct enketoId', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.simple2)
            .expect(200)
            .then(() => {
              global.enketo.enketoId = '::ijklmnop';
              return asAlice.post('/v1/projects/1/forms/simple2/draft')
                .expect(200)
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
                  { name: 'meta', path: '/meta', type: 'structure', binary: null, selectMultiple: null },
                  { name: 'instanceID', path: '/meta/instanceID', type: 'string', binary: null, selectMultiple: null },
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
            <meta>
              <instanceID>
            </meta>
            <q1.8>
              <17/>
            </q1.8>
            <4.2/>
          </data>
        </instance>
        <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
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
                  { name: 'meta', path: '/meta', type: 'structure', binary: null, selectMultiple: null },
                  { name: 'instanceID', path: '/meta/instanceID', type: 'string', binary: null, selectMultiple: null },
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
                    { name: 'goodone.csv', type: 'file', exists: false, blobExists: false, datasetExists: false, hash: null },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
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
                    { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2241de57bbec8144c8ad387e69b3a3ba' },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
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

        it('should return 307 if file has been moved to s3', testService((service, { Blobs }) => {
          global.s3.enableMock();
          return service.login('alice', (asAlice) =>
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
                }))
              .then(() => Blobs.s3UploadPending())
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
                .expect(307)
                .then(({ headers }) => {
                  headers.location.should.equal('s3://mock/2241de57bbec8144c8ad387e69b3a3ba/61baf7288ad1b373346a2fad6056d640746440be/goodone.csv?contentType=text/csv');
                })));
        }));

        it('should return 304 content not changed if ETag matches', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .send('test,csv\n1,2')
            .set('Content-Type', 'text/csv')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
            .expect(200);

          const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
            .expect(200);

          result.text.should.be.eql(
            'test,csv\n' +
              '1,2'
          );

          const etag = result.get('ETag');

          await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
            .set('If-None-Match', etag)
            .expect(304);

        }));

        it('should return latest content and correct ETag', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .send('test,csv\n1,2')
            .set('Content-Type', 'text/csv')
            .expect(200);

          const attachmentV1 = await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .expect(200);

          const etagV1 = attachmentV1.get('ETag');

          await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .send('test,csv\n1,2\n3,4')
            .set('Content-Type', 'text/csv')
            .expect(200);

          const attachmentV2 = await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .set('If-None-Match', etagV1)
            .expect(200);

          const etagV2 = attachmentV2.get('ETag');

          etagV1.should.not.be.eql(etagV2);
        }));

        it('should return latest content if previous content was uploaded to s3', testService(async (service, { Blobs }) => {
          global.s3.enableMock();

          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .send('test,csv\n1,2')
            .set('Content-Type', 'text/csv')
            .expect(200);

          const attachmentV1 = await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .expect(200);

          const etagV1 = attachmentV1.get('ETag');

          await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .set('If-None-Match', etagV1)
            .expect(304);

          await Blobs.s3UploadPending();

          await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .expect(307);

          await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .send('test,csv\n1,2\n3,4')
            .set('Content-Type', 'text/csv')
            .expect(200);

          const attachmentV2 = await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .set('If-None-Match', etagV1)
            .expect(200);

          const etagV2 = attachmentV2.get('ETag');

          await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .set('If-None-Match', etagV2)
            .expect(304);

          etagV1.should.not.be.eql(etagV2);
        }));

        it('should ignore local etag if content was uploaded to s3', testService(async (service, { Blobs }) => {
          global.s3.enableMock();

          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .send('test,csv\n1,2')
            .set('Content-Type', 'text/csv')
            .expect(200);

          const attachment = await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .expect(200);

          const etag = attachment.get('ETag');

          await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .set('If-None-Match', etag)
            .expect(304);

          await Blobs.s3UploadPending();

          await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .expect(307);

          await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
            .set('If-None-Match', etag)
            .expect(307);
        }));
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
          .send({ state: 'closing', webformsEnabled: true })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.state.should.equal('closing');
            body.webformsEnabled.should.equal(true);
          })
          .then(() => asAlice.get('/v1/projects/1/forms/simple')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Form();
              body.state.should.equal('closing');
              body.webformsEnabled.should.equal(true);
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

  ////////////////////////////////////////////////////////////////////////////////
  // Get Form by EnketoId
  ////////////////////////////////////////////////////////////////////////////////

  describe('/form-links/:enketoId/form', () => {
    it('should not return Form if it is in draft and no auth is provided', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft')
        .expect(200);

      const enketoId = await asAlice.get('/v1/projects/1/forms/simple/draft')
        .then(({ body }) => body.enketoId);

      await service.get(`/v1/form-links/${enketoId}/form`)
        .expect(403);
    }));

    it('should reject without session token', testService(async (service) => {
      const asAlice = await service.login('alice');

      const enketoId = await asAlice.get('/v1/projects/1/forms/simple')
        .then(({ body }) => body.enketoId);

      await service.get(`/v1/form-links/${enketoId}/form`)
        .expect(404);
    }));

    it('should return the Form with session token queryparam', testService(async (service) => {
      const asAlice = await service.login('alice');

      const enketoId = await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simple2)
        .expect(200)
        .then(({ body }) => body.enketoId);

      const token = await asAlice.post('/v1/projects/1/forms/simple2/public-links')
        .send({ displayName: 'link1' })
        .then(({ body }) => body.token);

      await service.get(`/v1/form-links/${enketoId}/form?st=${token}`)
        .expect(200);
    }));

    it('should allow form lookup by enketoId if form has multiple published versions', testService(async (service) => {
      const asAlice = await service.login('alice');
      global.enketo.enketoId = '::firstEnketoId';
      global.enketo.autoReset = false;
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simple2)
        .set('Content-Type', 'application/xml')
        .expect(200);
      global.enketo.enketoId = '::secondEnketoId';
      await asAlice.post('/v1/projects/1/forms/simple2/draft')
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/simple2/draft/publish?version=two')
        .expect(200);
      const { body: { enketoId } } = await asAlice.get('/v1/projects/1/forms/simple2')
        .expect(200);
      should.exist(enketoId);
      const token = await asAlice.post('/v1/projects/1/forms/simple2/public-links')
        .send({ displayName: 'link1' })
        .then(({ body }) => body.token);
      await service.get(`/v1/form-links/${enketoId}/form?st=${token}`)
        .expect(200);
    }));

    it('should return the Form by enketoOnceId', testService(async (service) => {
      const asAlice = await service.login('alice');

      const enketoOnceId = await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simple2)
        .expect(200)
        .then(({ body }) => body.enketoOnceId);

      const token = await asAlice.post('/v1/projects/1/forms/simple2/public-links')
        .send({ displayName: 'link1' })
        .then(({ body }) => body.token);

      await service.get(`/v1/form-links/${enketoOnceId}/form?st=${token}`)
        .expect(200);
    }));
  });
});
