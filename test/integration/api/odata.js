const should = require('should');
const { testService } = require('../setup');
const { validate } = require('fast-xml-parser');
const testData = require('../data');

// NOTE: for the data output tests, we do not attempt to extensively determine if every
// internal case is covered; there are already two layers of tests below these, at
// test/unit/data/json, then test/unit/outbound/odata. here we simply attempt to verify
// that we have plumbed the relevant input to those layers correctly, and have applied
// the appropriate higher-level logics (notfound, notauthorized, etc.)

describe('api: /forms/:id.svc', () => {
  describe('GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.get('/v1/forms/nonexistent.svc').expect(404)));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/forms/simple.svc').expect(403))));

    it('should return an OData service document', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/forms/withrepeat.svc')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/forms/withrepeat.svc/$metadata',
              value: [
                { name: 'Submissions', kind: 'EntitySet', url: 'Submissions' },
                { name: 'Submissions.children.child', kind: 'EntitySet', url: 'Submissions.children.child' }
              ]
            });
          }))));

    it('should set the appropriate response headers', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/forms/withrepeat.svc')
          .expect(200)
          .then(({ headers }) => {
            headers['odata-version'].should.equal('4.0');
            headers['content-type'].should.equal('application/json; charset=utf-8; odata.metadata=minimal');
          }))));
  });

  describe('/$metadata GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.get('/v1/forms/nonexistent.svc/$metadata').expect(404)));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/forms/simple.svc/$metadata').expect(403))));

    it('should return an EDMX metadata document', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/forms/simple.svc/$metadata')
          .expect(200)
          .then(({ text, headers }) => {
            validate(text).should.equal(true);
            text.should.startWith('<?xml version="1.0" encoding="UTF-8"?>\n<edmx:Edmx');
          }))));
  });

  describe("/Submissions(id)/… GET", () => {
    it('should reject unless the form exists', testService((service) =>
      service.get("/v1/forms/nonexistent.svc/Submissions('xyz')").expect(404)));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get("/v1/forms/simple.svc/Submissions('xyz')").expect(403))));

    const withSubmission = (service, callback) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/forms')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/forms/doubleRepeat/submissions')
            .send(testData.instances.doubleRepeat.double)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => callback(asAlice))));

    it('should reject if the submission does not exist', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/forms/doubleRepeat.svc/Submissions('nonexistent')").expect(404))));

    it('should return a single row result', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/forms/doubleRepeat.svc/Submissions('double')")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/forms/doubleRepeat.svc/$metadata#Submissions',
              value: [{
                __id: "double",
                children: {},
                meta: { instanceID: "double" },
                name: "Vick"
              }]
            });
          }))));

    it('should return subtable results', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/forms/doubleRepeat.svc/Submissions('double')/children/child")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: '46ebf42ee83ddec5028c42b2c054402d1e700208',
                '__Submissions-id': 'double',
                name: 'Alice'
              }, {
                __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                '__Submissions-id': 'double',
                name: 'Bob',
                toys: {}
              }, {
                __id: '8954b393f82c1833abb19be08a3d6cb382171f54',
                '__Submissions-id': 'double',
                name: 'Chelsea',
                toys: {}
              }]
            });
          }))));

    it('should limit and offset subtable results', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/forms/doubleRepeat.svc/Submissions('double')/children/child?$top=1&$skip=1")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': "http://localhost:8989/v1/forms/doubleRepeat.svc/Submissions('double')/children/child?%24skip=2",
              value: [{
                __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                '__Submissions-id': 'double',
                name: 'Bob',
                toys: {}
              }]
            });
          }))));
  });

  describe("/Submissions.xyz.* GET", () => {
    it('should reject unless the form exists', testService((service) =>
      service.get("/v1/forms/nonexistent.svc/Submissions").expect(404)));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get("/v1/forms/simple.svc/Submissions").expect(403))));

    const withSubmissions = (service, callback) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200)
              .then(() => callback(asAlice)))));

    it('should return toplevel rows', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/forms/withrepeat.svc/Submissions')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/forms/withrepeat.svc/$metadata#Submissions',
              value: [{
                __id: "three",
                meta: { instanceID: "three" },
                name: "Chelsea",
                age: 38,
                children: {}
              }, {
                __id: "two",
                meta: { instanceID: "two" },
                name: "Bob",
                age: 34,
                children: {}
              }, {
                __id: "one",
                meta: { instanceID: "one" },
                name: "Alice",
                age: 30
              }]
            });
          }))));

    it('should return subtable results', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/forms/withrepeat.svc/Submissions.children.child')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/forms/withrepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: 'beaedcdba519e6e6b8037605c9ae3f6a719984fa',
                '__Submissions-id': 'three',
                name: 'Candace',
                age: 2
              }, {
                __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d',
                '__Submissions-id': 'two',
                name: 'Billy',
                age: 4
              }, {
                __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
                '__Submissions-id': 'two',
                name: 'Blaine',
                age: 6
              }]
            });
          }))));

    // no particular reason we choose subtable rather than toplevel here.
    it('should limit and offset subtable results', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get("/v1/forms/withrepeat.svc/Submissions.children.child?$top=1&$skip=1")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/forms/withrepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': "http://localhost:8989/v1/forms/withrepeat.svc/Submissions.children.child?%24skip=2",
              value: [{
                __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d',
                '__Submissions-id': 'two',
                name: 'Billy',
                age: 4
              }]
            });
          }))));
  });
});

