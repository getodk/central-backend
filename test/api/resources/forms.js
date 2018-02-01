const should = require('should');
const { DateTime } = require('luxon');
const { validate, parse } = require('fast-xml-parser');
const { testService } = require('../setup');
const testData = require('../data');

describe('api: /forms', () => {
  describe('GET', () => {
    it('should reject unless the user can list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/forms').expect(403))));

    it('should list forms in order', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/forms')
          .expect(200)
          .then(({ body }) => {
            body.forEach((form) => form.should.be.a.Form());
            body.map((form) => form.xmlFormId).should.eql([ 'withrepeat', 'simple' ]);
            body.map((form) => form.hash).should.eql([ '000eb66ff915cd97a896d9e5dea39469', '5c09c21d4c71f2f13f6aa26227b2d133' ]);
            body.map((form) => form.version).should.eql([ '1.0', null ]);
          }))));

    it('should provide extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/forms')
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
    it('should reject unless the user can list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/formlist')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .expect(403))));

    it('should return form details as xml', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/formlist')
          .set('X-OpenRosa-Version', '1.0')
          .set('Date', DateTime.local().toHTTP())
          .expect(200)
          .then(({ text, headers }) => {
            // TODO: re-evaluate if fragile.
            parse(text, { textNodeConversion: false }).should.eql({
              xforms: {
                xform: [{
                  formID: 'withrepeat',
                  name: '',
                  version: '1.0',
                  hash: 'md5:000eb66ff915cd97a896d9e5dea39469',
                  downloadUrl: 'http://localhost:8989/v1/forms/withrepeat.xml'
                }, {
                  formID: 'simple',
                  name: 'Simple',
                  version: '',
                  hash: 'md5:5c09c21d4c71f2f13f6aa26227b2d133',
                  downloadUrl: 'http://localhost:8989/v1/forms/simple.xml'
                }]
              }
            });

            // Collect is particular about this:
            headers['content-type'].should.equal('text/xml; charset=utf-8');
          }))));
  });

  describe('POST', () => {
    it('should reject unless the user can create', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(403))));

    it('should reject if the xml is malformed', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/forms')
          .send('<hello')
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.1);
            body.details.should.eql({ format: 'xml', rawLength: 6 });
          }))));

    it('should reject if the form id cannot be found', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/forms')
          .send('<test/>')
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.2);
            body.details.should.eql({ field: 'formId' });
          }))));

    it('should reject if the form id already exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/forms')
          .send(testData.forms.simple)
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.5);
            body.details.field.should.equal('"xmlFormId"');
            body.details.value.should.equal('simple');
          }))));

    it('should return the created form upon success', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.name.should.equal('Simple 2');
            body.version.should.equal('2.1');
            body.hash.should.equal('07ed8a51cc3f6472b7dfdc14c2005861');
          }))));
  });

  describe('/:id.xml GET', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/forms/simple.xml').expect(403))));

    it('should return just xml', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/forms/simple')
          .expect(200)
          .then((full) => 
            asAlice.get('/v1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => {
                full.body.xml.should.equal(text);
                validate(text).should.equal(true);
              })))));
  });

  describe('/:id GET', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/forms/simple').expect(403))));

    it('should return basic form details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/forms/simple')
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Form();
            body.xmlFormId.should.equal('simple');
          }))));

    it('should return extended form details', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/forms/simple')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.should.be.an.ExtendedForm();
            body.xmlFormId.should.equal('simple');
          }))));
  });
});

