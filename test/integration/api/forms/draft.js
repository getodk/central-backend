const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');
const { Form } = require(appRoot + '/lib/model/frames');

const { exhaust } = require(appRoot + '/lib/worker/worker');
const { sql } = require('slonik');

describe('api: /projects/:id/forms (drafts)', () => {

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

      it('should create a new draft token while setting a new draft', testService((service) =>
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
                    // eslint-disable-next-line no-shadow
                    .then(({ body }) => {
                      body.draftToken.should.be.a.token();
                      body.draftToken.should.not.equal(draftToken);
                    }));
              })))));

      it('should request an enketoId while setting a new draft', testService(async (service, { env }) => {
        const asAlice = await service.login('alice');
        global.enketo.enketoId = '::ijklmnop';
        await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
        global.enketo.callCount.should.equal(1);
        global.enketo.receivedUrl.startsWith(env.domain).should.be.true();
        const match = global.enketo.receivedUrl.match(/\/v1\/test\/([a-z0-9$!]{64})\/projects\/1\/forms\/simple\/draft$/i);
        should.exist(match);
        const { body } = await asAlice.get('/v1/projects/1/forms/simple/draft')
          .expect(200);
        match[1].should.equal(body.draftToken);
        body.enketoId.should.equal('::ijklmnop');
      }));

      it('should request a new enketoId while setting each new draft', testService(async (service, { env }) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
        await asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
          .expect(200);
        global.enketo.callCount.should.equal(2);
        global.enketo.enketoId = '::ijklmnop';
        await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
        global.enketo.callCount.should.equal(3);
        global.enketo.receivedUrl.startsWith(env.domain).should.be.true();
        const match = global.enketo.receivedUrl.match(/\/v1\/test\/([a-z0-9$!]{64})\/projects\/1\/forms\/simple\/draft$/i);
        should.exist(match);
        const { body } = await asAlice.get('/v1/projects/1/forms/simple/draft')
          .expect(200);
        match[1].should.equal(body.draftToken);
        body.enketoId.should.equal('::ijklmnop');
      }));

      it('should return with success even if the request to Enketo fails', testService(async (service) => {
        const asAlice = await service.login('alice');
        global.enketo.state = 'error';
        await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
        const { body } = await asAlice.get('/v1/projects/1/forms/simple/draft')
          .expect(200);
        should.not.exist(body.enketoId);
      }));

      it('should wait for Enketo only briefly @slow', testService(async (service) => {
        const asAlice = await service.login('alice');
        global.enketo.wait = (done) => { setTimeout(done, 600); };
        await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
        const { body } = await asAlice.get('/v1/projects/1/forms/simple/draft')
          .expect(200);
        should.not.exist(body.enketoId);
      }));

      it('should request an enketoId from the worker if the request from the endpoint fails', testService(async (service, container) => {
        const asAlice = await service.login('alice');
        global.enketo.state = 'error';
        await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
        global.enketo.callCount.should.equal(1);
        global.enketo.enketoId = '::ijklmnop';
        await exhaust(container);
        global.enketo.callCount.should.equal(2);
        global.enketo.receivedUrl.startsWith(container.env.domain).should.be.true();
        const match = global.enketo.receivedUrl.match(/\/v1\/test\/([a-z0-9$!]{64})\/projects\/1\/forms\/simple\/draft$/i);
        should.exist(match);
        const { body } = await asAlice.get('/v1/projects/1/forms/simple/draft')
          .expect(200);
        match[1].should.equal(body.draftToken);
        body.enketoId.should.equal('::ijklmnop');
        should.not.exist(body.enketoOnceId);
      }));

      it('should not request an enketoId from the worker if the request from the endpoint succeeds', testService(async (service, container) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
        global.enketo.callCount.should.equal(1);
        await exhaust(container);
        global.enketo.callCount.should.equal(1);
      }));

      it('should manage draft/published enketo tokens separately', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.simple2)
            .expect(200)
            .then(() => {
              global.enketo.enketoId = '::ijklmnop';
              return asAlice.post('/v1/projects/1/forms/simple2/draft')
                .expect(200)
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

      it('should keep the draft token while replacing the draft', testService((service) =>
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
                    // eslint-disable-next-line no-shadow
                    .then(({ body }) => {
                      body.draftToken.should.equal(draftToken);
                    }));
              })))));

      it('should keep the enketoId while replacing the draft', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.callCount.should.equal(1);
        const { body: draft1 } = await asAlice.get('/v1/projects/1/forms/simple/draft')
          .expect(200);
        draft1.enketoId.should.equal('::abcdefgh');
        await asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.callCount.should.equal(1);
        const { body: draft2 } = await asAlice.get('/v1/projects/1/forms/simple/draft')
          .expect(200);
        draft2.enketoId.should.equal('::abcdefgh');
      }));

      it('should not request an enketoId from the worker while replacing the draft', testService(async (service, container) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.callCount.should.equal(1);
        await asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);
        global.enketo.callCount.should.equal(1);
      }));

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
            .then(() => asAlice.post('/v1/projects/1/forms/itemsets/draft?ignoreWarnings=true')
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
          asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
            .send(testData.forms.simple
              .replace('id="simple"', 'id="simple" version="2"')
              .replace(/age/g, 'number'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
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

      it('should complain on downcast from group to string', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('nodeset="/data/meta/instanceID"', 'nodeset="/data/meta"'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.17);
              body.details.should.eql({ path: '/meta', type: 'structure' });
            }))));

      it('should complain on downcast from repeat to string', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/withrepeat/draft')
            .send(testData.forms.withrepeat
              .replace('</model>', '<bind nodeset="/data/children/child" type="string"/></model>')
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
          asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
            .send(testData.forms.simple.replace(/age/g, 'number'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
              .send(testData.forms.simple.replace(/age/g, 'number').replace('type="int"', 'type="string"'))
              .set('Content-Type', 'application/xml')
              .expect(200)))));


      it('should allow new draft with missing meta group', testService(async (service) => {
        // This case is not expected, but it mimics a different scenario where there are
        // already meta-less forms in a user's central repo and they need to be able to update them
        // without breaking their workflows.
        const asAlice = await service.login('alice');

        const simpleMissingMeta = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
          <h:head>
            <h:title>Simple</h:title>
            <model>
              <instance>
                <data id="simple">
                  <name/>
                  <age/>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/age" type="int"/>
            </model>
          </h:head>
        </h:html>`;

        await asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
          .send(simpleMissingMeta)
          .set('Content-Type', 'application/xml')
          .expect(200);
      }));

      it('should identify attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
            .send(testData.forms.withAttachments.replace('id="withAttachments"', 'id="simple"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft/attachments')
              .expect(200)
              .then(({ body }) => {
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: false, blobExists: false, datasetExists: false, hash: null },
                  { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
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
                // eslint-disable-next-line no-param-reassign
                delete body[0].updatedAt;
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2af2751b79eccfaa8f452331e76e679e' },
                  { name: 'greattwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
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
                // eslint-disable-next-line no-param-reassign
                delete body[0].updatedAt;
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2af2751b79eccfaa8f452331e76e679e' },
                  { name: 'greattwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
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
                    })))))));

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
                    })))))));

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

      describe('purging unneeded drafts', () => {
        it('should purge the old undeeded draft when a new version is uploaded', testService((service, { oneFirst }) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
                .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
                .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty3"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple'`)
                .then((count) => {
                  count.should.equal(2); // one for the first published version and for the new draft
                })))));

        it('should purge the old undeeded draft when a new version is uploaded (and no published draft)', testService((service, { oneFirst }) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simple2)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                .send(testData.forms.simple2.replace('id="simple2"', 'id="simple2" version="drafty2"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                .send(testData.forms.simple2.replace('id="simple2"', 'id="simple2" version="drafty3"'))
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple2'`)
                .then((count) => {
                  count.should.equal(1); // only one for the new draft
                })))));

        describe('purging form fields of unneeded drafts', () => {
          it('should not purge fields because they are part of schema of published form', testService((service, { oneFirst }) =>
            service.login('alice', (asAlice) =>
              asAlice.post('/v1/projects/1/forms/simple/draft')
                .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
                .set('Content-Type', 'application/xml')
                .expect(200)
                .then(() => Promise.all([
                  oneFirst(sql`select count(*) from form_defs where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_fields where "formId" = 1`)
                ]))
                .then((counts) => counts.should.eql([ 2, 4 ]))
                .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
                  .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
                  .set('Content-Type', 'application/xml')
                  .expect(200))
                .then(() => Promise.all([
                  oneFirst(sql`select count(*) from form_defs where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_fields where "formId" = 1`)
                ]))
                .then((counts) => counts.should.eql([ 2, 4 ])))));

          it('should purge fields of unneeded intermediate draft with different schema', testService((service, { oneFirst }) =>
            service.login('alice', (asAlice) =>
              asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
                .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"').replace(/age/g, 'number'))
                .set('Content-Type', 'application/xml')
                .expect(200)
                .then(() => Promise.all([
                  oneFirst(sql`select count(*) from form_defs where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_fields where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_schemas`)
                ]))
                .then((counts) => counts.should.eql([ 2, 8, 3 ]))
                .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
                  .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"')) // back to original schema
                  .set('Content-Type', 'application/xml')
                  .expect(200))
                .then(() => Promise.all([
                  oneFirst(sql`select count(*) from form_defs where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_fields where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_schemas`) // 2: one for each different form
                ]))
                .then((counts) => counts.should.eql([ 2, 4, 2 ]))
                .then(() => asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
                  .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty3"').replace(/age/g, 'number')) // new schema again
                  .set('Content-Type', 'application/xml')
                  .expect(200))
                .then(() => Promise.all([
                  oneFirst(sql`select count(*) from form_defs where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_fields where "formId" = 1`),
                  oneFirst(sql`select count(*) from form_schemas`) // new schema brought back
                ]))
                .then((counts) => counts.should.eql([ 2, 8, 3 ])))));

          it('should purge the form field and schema of intermediate version (and no published draft)', testService((service, { oneFirst }) =>
            service.login('alice', (asAlice) =>
              asAlice.post('/v1/projects/1/forms')
                .send(testData.forms.simple2) // first draft version
                .set('Content-Type', 'application/xml')
                .expect(200)
                .then(() => asAlice.post('/v1/projects/1/forms/simple2/draft')
                  .send(testData.forms.simple2.replace('id="simple2"', 'id="simple2" version="drafty2"').replace(/age/g, 'number'))
                  .set('Content-Type', 'application/xml')
                  .expect(200))
                .then(() => Promise.all([
                  oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple2'`),
                  oneFirst(sql`select count(*) from form_fields as fs join forms as f on fs."formId" = f.id where f."xmlFormId"='simple2'`),
                  oneFirst(sql`select count(*) from form_schemas`) // two fixture forms and one for this form
                ]))
                .then((counts) => counts.should.eql([ 1, 4, 3 ])))));
        });
      });

      describe('preserving submissions from old or deleted drafts', () => {
        it('should allow new draft submissions to be sent after soft-deleting old ones', testService(async (service) => {
          const asAlice = await service.login('alice');

          // Create a draft of a published form
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          // Replace the draft with a new version
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Send the submission (with a new, non-conflicting instance id) to the new draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.two)
            .set('Content-Type', 'text/xml')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].instanceId.should.equal('two');
            });
        }));

        it('should NOT allow a new draft submission to be sent if it conflicts with a soft-deleted old ones', testService(async (service) => {
          const asAlice = await service.login('alice');

          // Create a draft of a published form
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          // Replace the draft with a new version
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Send the submission to the new draft but get a 409 conflict because the instance ID exists
          // in real usage, these instance IDs will be UUIDs so there shouldn't be conflicts
          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(409);
        }));

        it('should soft-delete submissions of undeeded draft when a new version is uploaded', testService(async (service, { oneFirst }) => {
          const asAlice = await service.login('alice');

          // Upload a new draft version
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Send a submission to that draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          // Check that the submission is there
          let subs = await oneFirst(sql`select count(*) from submissions`);
          subs.should.equal(1);

          // Upload a new draft version to replace the old one
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Confirm that the previous submission is still there but soft-deleted
          subs = await oneFirst(sql`select count(*) from submissions where "deletedAt" is not null`);
          subs.should.equal(1);

          // Confirm that the draft def is still there, too, in addition to the new draft def and published def
          const fds = await oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple'`);
          fds.should.equal(3);
        }));

        it('should soft-delete submissions of draft when it is abandoned/deleted', testService(async (service, { oneFirst }) => {
          const asAlice = await service.login('alice');

          // Upload a new draft version
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Send a submission to that draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          // Delete the draft
          await asAlice.delete('/v1/projects/1/forms/simple/draft');

          // Confirm that the submission is still there but soft-deleted
          const subs = await oneFirst(sql`select count(*) from submissions where "deletedAt" is not null`);
          subs.should.equal(1);

          // Confirm that there are two defs (the draft def that was unlinked and the published def)
          const fds = await oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple'`);
          fds.should.equal(2);
        }));

        it('should soft-delete submissions of draft when it is published', testService(async (service, { oneFirst }) => {
          const asAlice = await service.login('alice');

          // Upload a new draft version
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Send a submission to that draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          // Publish the form draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/publish');

          // Confirm that the submission is still there but soft-deleted
          const subs = await oneFirst(sql`select count(*) from submissions where "deletedAt" is not null`);
          subs.should.equal(1);

          // Confirm that there are two defs (the previously published version and new published version)
          const fds = await oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple'`);
          fds.should.equal(2);
        }));

        it('should soft-delete submissions of draft when it is published AND the version is set on publish', testService(async (service, { oneFirst }) => {
          const asAlice = await service.login('alice');

          // Upload a new draft version
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Send a submission to that draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          // Publish the form draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two');

          // Confirm that the submission is still there but soft-deleted
          const subs = await oneFirst(sql`select count(*) from submissions where "deletedAt" is not null`);
          subs.should.equal(1);

          // Confirm that there are three defs
          // - previously published
          // - draft def
          // - new published version (from draft def but with new version)
          const fds = await oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple'`);
          fds.should.equal(3);
        }));

        it('should purge draft submissions when project is encrypted', testService(async (service, { oneFirst }) => {
          const asAlice = await service.login('alice');

          // Upload a new draft version
          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // Send a submission to that draft
          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          // Encrypt the project
          await asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret' })
            .expect(200);

          // Confirm that the submissions have been purged
          const subs = await oneFirst(sql`select count(*) from submissions where "deletedAt" is not null`);
          subs.should.equal(0);

          // Confirm that there are 3 form defs
          // - the original published version
          // - encrypted published version
          // - encrypted draft
          const fds = await oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple'`);
          fds.should.equal(3);
        }));

        it('should purge old draft submissions after 30 days', testService(async (service, { oneFirst, run, Forms, Submissions }) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
            .send(testData.instances.simple.one)
            .set('Content-Type', 'text/xml')
            .expect(200);

          let subs = await oneFirst(sql`select count(*) from submissions`);
          subs.should.equal(1);

          await asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          await run(sql`update submissions set "deletedAt" = '1999-1-1T00:00:00Z' where "deletedAt" is not null`);
          await Submissions.purge();
          await Forms.clearUnneededDrafts();

          subs = await oneFirst(sql`select count(*) from submissions`);
          subs.should.equal(0);

          const fds = await oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simple'`);
          fds.should.equal(2); // Old draft has now been deleted. Count also includes published and new draft.
        }));

        describe('experimental - recovering deleted draft submissions', () => {
          it('should work in the straight forward case of replacing active draft with previous draft and submissions', testService(async (service, { oneFirst, run, Submissions }) => {
            const asAlice = await service.login('alice');

            // Create a draft of a published form
            await asAlice.post('/v1/projects/1/forms/simple/draft')
              .expect(200);

            // Get the draft def id and form id for later use
            const oldDraftDefId = await oneFirst(sql`select "draftDefId" from forms where "xmlFormId"='simple'`);
            const formId = await oneFirst(sql`select "id" from forms where "xmlFormId"='simple'`);

            // Send a submission to the draft
            await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Send a second submission
            await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Confirm that both draft submissions are visible before we replace the draft
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .then(({ body }) => {
                body.length.should.equal(2);
              });

            // Replace the draft with a new version
            await asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
              .set('Content-Type', 'application/xml')
              .expect(200);

            // Confirm that none of the deleted draft submissions are visible
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .then(({ body }) => {
                body.length.should.equal(0);
              });

            // Send the submission (with a new instance id) to the same draft form again
            await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.three)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Confirm that for THIS draft version, there is only one submission
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .then(({ body }) => {
                body.length.should.equal(1);
              });

            // ----- Swap out old draft submissions ----

            // Soft-delete the existing draft submissions
            await Submissions.deleteDraftSubmissions(formId);

            // Recover the deleted draft submissions by first setting the previous draft to the current draft
            await run(sql`update forms set "draftDefId" = ${oldDraftDefId} where "xmlFormId"='simple'`);

            // Undelete the submissions associated with first draft def
            await run(sql`
              UPDATE submissions
              SET "deletedAt" = null
              FROM submission_defs
              WHERE submissions."id" = submission_defs."submissionId"
              AND submissions."deletedAt" IS NOT NULL
              AND submission_defs."formDefId" = ${oldDraftDefId};`);

            // Confirm that both draft submissions are visible again
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .then(({ body }) => {
                body.length.should.equal(2);
              });
          }));

          it('should combine draft subs from two draft versions if recovering old subs without deleting new ones', testService(async (service, { oneFirst, run }) => {
            const asAlice = await service.login('alice');

            // Create a draft of a published form
            await asAlice.post('/v1/projects/1/forms/simple/draft')
              .expect(200);

            // Get the draft def id for later use
            const oldDraftDefId = await oneFirst(sql`select "draftDefId" from forms where "xmlFormId"='simple'`);

            // Send a submission to the draft
            await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Replace the draft with a new version
            await asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
              .set('Content-Type', 'application/xml')
              .expect(200);

            // Send the submission with a different instance ID to the new draft
            await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Confirm that for current draft version, there is only one submission
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .then(({ body }) => {
                body.length.should.equal(1);
              });

            // ----- Un-delete old draft submissions ----
            // without swapping the draft def, keeping the current draft def as the active draft

            // Undelete the submissions associated with first draft def. This is possible
            // because instanceIds don't intersect.
            await run(sql`
              UPDATE submissions
              SET "deletedAt" = null
              FROM submission_defs
              WHERE submissions."id" = submission_defs."submissionId"
              AND submissions."deletedAt" IS NOT NULL
              AND submission_defs."formDefId" = ${oldDraftDefId};`);

            // Confirm that both draft submissions are visible even though they were for
            // different draft def IDs
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .then(({ body }) => {
                body.length.should.equal(2);
              });
          }));

          it('should recover draft subs in a def that got published (without changing the version) by adding them to the published subs', testService(async (service, { oneFirst, all, run }) => {
            const asAlice = await service.login('alice');

            // Create a draft of a published form
            await asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
              .set('Content-Type', 'application/xml')
              .expect(200);

            // Get the draft def id for later use
            const oldDraftDefId = await oneFirst(sql`select "draftDefId" from forms where "xmlFormId"='simple'`);

            // Send a submission to the draft
            await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Publish the draft
            await asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200);

            // Send a submission to the published form (new version)
            await asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.two
                .replace('id="simple"', 'id="simple" version="two"')
              )
              .set('Content-Type', 'application/xml')
              .expect(200);

            // confirm that there is no draft version
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .expect(404);

            // Confirm that for current published version, there is only one submission
            await asAlice.get('/v1/projects/1/forms/simple/submissions')
              .then(({ body }) => {
                body.length.should.equal(1);
              });

            // Show that both submissions are attached to the same form def id
            const sds = await oneFirst(sql`select count(*) from submission_defs where "formDefId" = ${oldDraftDefId}`);
            sds.should.equal(2);

            const subs = await all(sql`select * from submissions order by id`);
            subs[0].instanceId.should.equal('one');
            subs[0].deletedAt.should.not.be.null();
            subs[0].draft.should.equal(true);

            subs[1].instanceId.should.equal('two');
            should(subs[1].deletedAt).be.null();
            subs[1].draft.should.equal(false);

            // ----- Un-delete old draft submissions ----
            // the draft def became the published def so the deleted draft subs
            // can only be brought back as regular published subs
            // IF there are no instanceId conflicts, which there aren't in this case

            await run(sql`
              UPDATE submissions
              SET "deletedAt" = null, draft = false
              FROM submission_defs
              WHERE submissions."id" = submission_defs."submissionId"
              AND submissions."deletedAt" IS NOT NULL
              AND submission_defs."formDefId" = ${oldDraftDefId};`);

            // Confirm that both draft submissions are visible in the published for submissions
            // even though they were for a form def ID that was originally a draft.
            await asAlice.get('/v1/projects/1/forms/simple/submissions')
              .then(({ body }) => {
                body.length.should.equal(2);
              });
          }));

          it('should show what happens when a published def is set as the draft def of the form', testService(async (service, { one, oneFirst, run }) => {
            const asAlice = await service.login('alice');

            // Upload a new draft with a new version
            await asAlice.post('/v1/projects/1/forms/simple/draft')
              .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="drafty2"'))
              .set('Content-Type', 'application/xml')
              .expect(200);

            // Get the draft def id and form id for later use
            const oldDraftDefId = await oneFirst(sql`select "draftDefId" from forms where "xmlFormId"='simple'`);

            // Send a submission to the draft
            await asAlice.post('/v1/projects/1/forms/simple/draft/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Publish the draft
            await asAlice.post('/v1/projects/1/forms/simple/draft/publish')
              .expect(200);

            // Set the old draft def as the draft def of the form (but this is also the same as th current def)
            await run(sql`update forms set "draftDefId" = ${oldDraftDefId} where "xmlFormId"='simple'`);

            // Show that the currentDefId and draftDefId are the same on the form
            const formRow = await one(sql`select "currentDefId", "draftDefId" from forms where "xmlFormId"='simple'`);
            formRow.currentDefId.should.equal(formRow.draftDefId);

            // Before submission recovery, confirm that are no submissions for the published form
            await asAlice.get('/v1/projects/1/forms/simple/submissions')
              .then(({ body }) => {
                body.length.should.equal(0);
              });

            // Undelete the submissions associated with the draft def while keeping it as a draft submission
            await run(sql`
              UPDATE submissions
              SET "deletedAt" = null
              FROM submission_defs
              WHERE submissions."id" = submission_defs."submissionId"
              AND submissions."deletedAt" IS NOT NULL
              AND submission_defs."formDefId" = ${oldDraftDefId};`);

            // After submission recovery, there should still be zero submissions because the only submission is a draft
            await asAlice.get('/v1/projects/1/forms/simple/submissions')
              .then(({ body }) => {
                body.length.should.equal(0);
              });

            // But the submissions should be visible for the draft form
            await asAlice.get('/v1/projects/1/forms/simple/draft/submissions')
              .then(({ body }) => {
                body.length.should.equal(1);
              });
          }));
        });
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

      it('should return the correct enketoId with extended draft', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.simple2)
            .expect(200)
            .then(() => {
              global.enketo.enketoId = '::ijklmnop';
              return asAlice.post('/v1/projects/1/forms/simple2/draft')
                .expect(200)
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

      it('should purge the draft when it is deleted', testService((service, { oneFirst }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.simple)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.delete('/v1/projects/1/forms/simple/draft')
              .expect(200))
            .then(() => oneFirst(sql`select count(*) from form_defs where "formId" = 1 and "publishedAt" is null`)
              .then((count) => {
                count.should.equal(0); // one for the first published version and for the new draft
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
                    // eslint-disable-next-line no-shadow
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
                // eslint-disable-next-line no-param-reassign
                delete body[0].updatedAt;
                body.should.eql([
                  { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2af2751b79eccfaa8f452331e76e679e' },
                  { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
                ]);
              })))));

      it('should request Enketo IDs when publishing for first time', testService(async (service, { env }) => {
        const asAlice = await service.login('alice');

        // Create a draft form.
        global.enketo.state = 'error';
        const { body: draft } = await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.callCount.should.equal(1);
        should.not.exist(draft.enketoId);
        should.not.exist(draft.enketoOnceId);

        // Publish.
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
          .expect(200);
        global.enketo.callCount.should.equal(2);
        global.enketo.receivedUrl.should.equal(`${env.domain}/v1/projects/1`);
        const { body: form } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        form.enketoId.should.equal('::abcdefgh');
        form.enketoOnceId.should.equal('::::abcdefgh');
      }));

      it('should return with success even if request to Enketo fails', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.state = 'error';
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
          .expect(200);
        const { body: form } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        should.not.exist(form.enketoId);
        should.not.exist(form.enketoOnceId);
      }));

      it('should wait for Enketo only briefly @slow', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.wait = (done) => { setTimeout(done, 600); };
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
          .expect(200);
        const { body: form } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        should.not.exist(form.enketoId);
        should.not.exist(form.enketoOnceId);
      }));

      it('should request Enketo IDs when republishing if they are missing', testService(async (service, { env }) => {
        const asAlice = await service.login('alice');

        // First publish
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.state = 'error';
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
          .expect(200);
        const { body: v1 } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        should.not.exist(v1.enketoId);
        should.not.exist(v1.enketoOnceId);

        // Republish
        await asAlice.post('/v1/projects/1/forms/simple2/draft').expect(200);
        global.enketo.callCount.should.equal(3);
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish?version=new')
          .expect(200);
        global.enketo.callCount.should.equal(4);
        global.enketo.receivedUrl.should.equal(`${env.domain}/v1/projects/1`);
        const { body: v2 } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        v2.enketoId.should.equal('::abcdefgh');
        v2.enketoOnceId.should.equal('::::abcdefgh');
      }));

      it('should not request Enketo IDs when republishing if they are present', testService(async (service) => {
        const asAlice = await service.login('alice');

        // First publish
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
          .expect(200);

        // Republish
        await asAlice.post('/v1/projects/1/forms/simple2/draft').expect(200);
        global.enketo.callCount.should.equal(3);
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish?version=new')
          .expect(200);
        global.enketo.callCount.should.equal(3);
        const { body: form } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        form.enketoId.should.equal('::abcdefgh');
        form.enketoOnceId.should.equal('::::abcdefgh');
      }));

      it('should request Enketo IDs from worker if request from endpoint fails', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // First request to Enketo, from the endpoint
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200);
        global.enketo.state = 'error';
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
          .expect(200);
        const { body: beforeWorker } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        should.not.exist(beforeWorker.enketoId);
        should.not.exist(beforeWorker.enketoOnceId);
        global.enketo.callCount.should.equal(2);

        // Second request, from the worker
        await exhaust(container);
        global.enketo.callCount.should.equal(3);
        global.enketo.receivedUrl.should.equal(`${container.env.domain}/v1/projects/1`);
        const { body: afterWorker } = await asAlice.get('/v1/projects/1/forms/simple2')
          .expect(200);
        afterWorker.enketoId.should.equal('::abcdefgh');
        afterWorker.enketoOnceId.should.equal('::::abcdefgh');
      }));

      it('should not request Enketo IDs from worker if request from endpoint succeeds', testService(async (service, container) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish')
          .expect(200);
        global.enketo.callCount.should.equal(2);
        await exhaust(container);
        global.enketo.callCount.should.equal(2);
      }));

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
                  // eslint-disable-next-line no-param-reassign
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

      it('should log the correct def ids in the form audit log', testService(async (service, { Forms }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simple2)
          .set('Content-Type', 'text/xml')
          .expect(200);

        const formT1 = await Forms.getByProjectAndXmlFormId(1, 'simple2').then((o) => o.get());

        await asAlice.post('/v1/projects/1/forms/simple2/draft')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2.replace('version="2.1"', 'version="2.2"'))
          .expect(200);

        const formT2 = await Forms.getByProjectAndXmlFormId(1, 'simple2', false, Form.DraftVersion).then((o) => o.get());

        await asAlice.post('/v1/projects/1/forms/simple2/draft')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2.replace('version="2.1"', 'version="2.3"'))
          .expect(200);

        const formT3 = await Forms.getByProjectAndXmlFormId(1, 'simple2', false, Form.DraftVersion).then((o) => o.get());

        await asAlice.post('/v1/projects/1/forms/simple2/draft/publish');

        const formT4 = await Forms.getByProjectAndXmlFormId(1, 'simple2').then((o) => o.get());

        await asAlice.get('/v1/audits?action=nonverbose')
          .expect(200)
          .then(({ body }) => {
            // first form event: form create
            body[4].action.should.equal('form.create');

            // second form event: form publish
            body[3].action.should.equal('form.update.publish');
            // new def id should match form def at time T1
            body[3].details.should.eql({ newDefId: formT1.def.id, oldDefId: null });

            // third form event: draft
            body[2].action.should.equal('form.update.draft.set');
            body[2].details.should.eql({ newDraftDefId: formT2.def.id, oldDraftDefId: null });

            // forth form event: draft
            body[1].action.should.equal('form.update.draft.set');
            body[1].details.should.eql({ newDraftDefId: formT3.def.id, oldDraftDefId: formT2.def.id });

            // fifth form event: publish
            body[0].action.should.equal('form.update.publish');
            body[0].details.should.eql({ newDefId: formT4.def.id, oldDefId: formT1.def.id });

            body.map(a => a.action).should.eql([
              'form.update.publish',
              'form.update.draft.set',
              'form.update.draft.set',
              'form.update.publish',
              'form.create',
              'user.session.create'
            ]);
          });
      }));
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
                  Users.getByEmail('alice@getodk.org').then((o) => o.get()),
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
                      newBlobId: attachment.blobId,
                      oldDatasetId: null,
                      newDatasetId: attachment.datasetId
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
                          newBlobId: attachment2.blobId,
                          oldDatasetId: attachment.datasetId,
                          newDatasetId: attachment2.datasetId
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
                  Users.getByEmail('alice@getodk.org').then((o) => o.get()),
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
                        newBlobId: null,
                        oldDatasetId: attachment.datasetId,
                        newDatasetId: null
                      });
                    }))))));

        // n.b. setting the appropriate updatedAt value is tested above in the / GET
        // extended metadata listing test!
      });
    });
  });
});
