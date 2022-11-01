const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');
// eslint-disable-next-line import/no-dynamic-require
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
                    // eslint-disable-next-line no-shadow
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
                    // eslint-disable-next-line no-shadow
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
                  { name: 'goodone.csv', type: 'file', exists: false, blobExists: false, datasetExists: false },
                  { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false }
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
                  { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false },
                  { name: 'greattwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false }
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
                  { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false },
                  { name: 'greattwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false }
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
                  { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false },
                  { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false }
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
