const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
// eslint-disable-next-line import/no-extraneous-dependencies
const superagent = require('superagent');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');
const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('api: /projects/:id/forms (versions)', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // VERSION MANAGEMENT TESTING
  ////////////////////////////////////////////////////////////////////////////////

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
                  // eslint-disable-next-line no-param-reassign
                  delete body[0].updatedAt;

                  body.should.eql([
                    { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2af2751b79eccfaa8f452331e76e679e' },
                    { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
                  ]);
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

  // These tests relate to adding new drafts with the same or different field
  // structure will reuse or change an intermedia form schema representation.
  describe('intermediate form schema', () => {
    it('should not make additional form schemas for a form with unchanged fields', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Submit to first version of form
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(testData.instances.simple.one);

      // Upload new version with same schema
      await asAlice.post('/v1/projects/1/forms/simple/draft')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/simple/draft/publish');

      // Submit to second version of form
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(testData.instances.simple.two.replace('id="simple"', 'id="simple" version="2"'))
        .expect(200);

      const fieldsBySchema = await container.all(sql`
      select count(*), "schemaId" from form_fields
      where "formId"=1
      group by "schemaId"`);
      fieldsBySchema.length.should.equal(1); // There should be only one schema
      fieldsBySchema[0].count.should.equal(4); // There should be four fields for that schema

      const defsBySchema = await container.all(sql`
      select count(*), "schemaId" from form_defs
      where "formId"=1
      group by "schemaId"`);
      defsBySchema.length.should.equal(1);
      defsBySchema[0].count.should.equal(2);

      // Check that two subs are there and export properly
      const lines = await asAlice.get('/v1/projects/1/forms/simple/submissions.csv')
        .expect(200)
        .then(({ text }) => text.split('\n'));
      lines[0].should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
      lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
        .should.equal(',two,Bob,34,two,5,Alice,0,0,,,,0,2');
      lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
        .should.equal(',one,Alice,30,one,5,Alice,0,0,,,,0,');
    }));

    it('should make additional form schema when fields change', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Submit to first version of form
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(testData.instances.simple.one);

      // Upload new version with different schema (1 field removed)
      await asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simple
          .replace('id="simple"', 'id="simple" version="2"')
          .replace('<age/>', ''))
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/simple/draft/publish');

      // Submit to second version of form
      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(testData.instances.simple.two
          .replace('id="simple"', 'id="simple" version="2"')
          .replace('<age>34</age>', ''))
        .expect(200);

      const fieldsBySchema = await container.all(sql`
        WITH count_by_schema AS (
          select count(*) as fieldcount, "schemaId" from form_fields
          where "formId"=1
          group by "schemaId"
        )
        SELECT cbs.fieldcount FROM count_by_schema cbs INNER JOIN form_defs fd USING ("schemaId")
        ORDER BY fd."createdAt" asc  -- order = order of creation
      `);
      fieldsBySchema.length.should.equal(2); // There should be two schemas
      fieldsBySchema[0].fieldcount.should.equal(4); // There should be four fields for that schema
      fieldsBySchema[1].fieldcount.should.equal(3);

      const defsBySchema = await container.all(sql`
      select count(*), "schemaId" from form_defs
      where "formId"=1
      group by "schemaId"
      order by "schemaId" asc`);
      defsBySchema.length.should.equal(2);
      defsBySchema[0].count.should.equal(1);
      defsBySchema[0].count.should.equal(1);

      // Check that two subs are there and export properly
      let lines = await asAlice.get('/v1/projects/1/forms/simple/submissions.csv')
        .expect(200)
        .then(({ text }) => text.split('\n'));
      lines[0].should.equal('SubmissionDate,meta-instanceID,name,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
      lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
        .should.equal(',two,Bob,two,5,Alice,0,0,,,,0,2');
      lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
        .should.equal(',one,Alice,one,5,Alice,0,0,,,,0,');

      // Check that two subs are there and export properly
      lines = await asAlice.get('/v1/projects/1/forms/simple/submissions.csv?deletedFields=true')
        .expect(200)
        .then(({ text }) => text.split('\n'));
      lines[0].should.equal('SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
      lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
        .should.equal(',two,Bob,,two,5,Alice,0,0,,,,0,2');
      lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
        .should.equal(',one,Alice,30,one,5,Alice,0,0,,,,0,');
    }));
  });
});
