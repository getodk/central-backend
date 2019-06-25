const should = require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');

// NOTE: for the data output tests, we do not attempt to extensively determine if every
// internal case is covered; there are already two layers of tests below these, at
// test/unit/data/json, then test/unit/outbound/odata. here we simply attempt to verify
// that we have plumbed the relevant input to those layers correctly, and have applied
// the appropriate higher-level logics (notfound, notauthorized, etc.)

describe('api: /forms/:id.svc', () => {
  describe('GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent.svc').expect(404))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple.svc').expect(403))));

    it('should return an OData service document', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata',
              value: [
                { name: 'Submissions', kind: 'EntitySet', url: 'Submissions' },
                { name: 'Submissions.children.child', kind: 'EntitySet', url: 'Submissions.children.child' }
              ]
            });
          }))));

    it('should set the appropriate response headers', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc')
          .expect(200)
          .then(({ headers }) => {
            headers['odata-version'].should.equal('4.0');
            headers['content-type'].should.equal('application/json; charset=utf-8; odata.metadata=minimal');
          }))));
  });

  describe('/$metadata GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent.svc/$metadata').expect(404))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple.svc/$metadata').expect(403))));

    it('should return an EDMX metadata document', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple.svc/$metadata')
          .expect(200)
          .then(({ text, headers }) => {
            text.should.startWith('<?xml version="1.0" encoding="UTF-8"?>\n<edmx:Edmx');
          }))));
  });

  describe("/Submissions(id)/… GET", () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get("/v1/projects/1/forms/nonexistent.svc/Submissions('xyz')").expect(404))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get("/v1/projects/1/forms/simple.svc/Submissions('xyz')").expect(403))));

    const withSubmission = (service, callback) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions')
            .send(testData.instances.doubleRepeat.double)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => callback(asAlice))));

    it('should reject if the submission does not exist', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('nonexistent')").expect(404))));

    it('should return a single row result', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')")
          .expect(200)
          .then(({ body }) => {
            // have to manually check and clear the date for exact match:
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            delete body.value[0].__system.submissionDate;

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions',
              value: [{
                __id: "double",
                __system: {
                  // submissionDate is checked above!
                  submitterId: '5',
                  submitterName: 'Alice',
                  encrypted: false
                },
                children: {},
                meta: { instanceID: "double" },
                name: "Vick"
              }]
            });
          }))));

    it('should return a single encrypted frame', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get("/v1/projects/1/forms/encrypted.svc/Submissions('uuid:dcf4a151-5088-453f-99e6-369d67828f7a')")
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the date for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              delete body.value[0].__system.submissionDate;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/encrypted.svc/$metadata#Submissions',
                value: [{
                  __id: 'uuid:dcf4a151-5088-453f-99e6-369d67828f7a',
                  __system: {
                    // submissionDate is checked above!
                    submitterId: '5',
                    submitterName: 'Alice',
                    encrypted: true
                  }
                }]
              })
            })))));

    it('should return subtable results', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
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
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child?$top=1&$skip=1")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': "http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child?%24skip=2",
              value: [{
                __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                '__Submissions-id': 'double',
                name: 'Bob',
                toys: {}
              }]
            });
          }))));

    // HACK: this test sort of relies on some trickery to make the backend
    // thing the submission is encrypted even though it isn't (see the replace
    // call). there is some chance this methodology is fragile. (mark1)
    it('should gracefully degrade on encrypted subtables', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions')
            .send(testData.instances.doubleRepeat.double.replace('</data>',
              '<encryptedXmlFile>x</encryptedXmlFile><base64EncryptedKey>y</base64EncryptedKey></data>'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child")
            .expect(200)
            .then(({ body }) => {
              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
                value: []
              })
            })))));
  });

  describe('/Submissions.xyz.* GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get("/v1/projects/1/forms/nonexistent.svc/Submissions").expect(404))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get("/v1/projects/1/forms/simple.svc/Submissions").expect(403))));

    const withSubmissions = (service, callback) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200)
              .then(() => callback(asAlice)))));

    it('should return toplevel rows', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions')
          .expect(200)
          .then(({ body }) => {
            for (const idx of [ 0, 1, 2 ]) {
              body.value[idx].__system.submissionDate.should.be.an.isoDate();
              delete body.value[idx].__system.submissionDate;
            }

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
              value: [{
                __id: "three",
                __system: {
                  // submissionDate is checked above,
                  submitterId: "5",
                  submitterName: "Alice",
                  encrypted: false
                },
                meta: { instanceID: "three" },
                name: "Chelsea",
                age: 38,
                children: {}
              }, {
                __id: "two",
                __system: {
                  // submissionDate is checked above,
                  submitterId: "5",
                  submitterName: "Alice",
                  encrypted: false
                },
                meta: { instanceID: "two" },
                name: "Bob",
                age: 34,
                children: {}
              }, {
                __id: "one",
                __system: {
                  // submissionDate is checked above,
                  submitterId: "5",
                  submitterName: "Alice",
                  encrypted: false
                },
                meta: { instanceID: "one" },
                name: "Alice",
                age: 30
              }]
            });
          }))));

    it('should return a count even if there are no rows', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$count=true')
          .expect(200)
          .then(({ body }) => {
            body['@odata.count'].should.equal(0);
          }))));

    it('should return subtable results', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions.children.child')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions.children.child',
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

    it('should limit and offset toplevel rows', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/withrepeat.svc/Submissions?$top=1&$skip=1")
          .expect(200)
          .then(({ body }) => {
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            delete body.value[0].__system.submissionDate;

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
              '@odata.nextLink': "http://localhost:8989/v1/projects/1/forms/withrepeat.svc/Submissions?%24skip=2",
              value: [{
                __id: "two",
                __system: {
                  // submissionDate is checked above,
                  submitterId: "5",
                  submitterName: "Alice",
                  encrypted: false
                },
                meta: { instanceID: "two" },
                name: "Bob",
                age: 34,
                children: {}
              }]
            });
          }))));

    it('should provide toplevel row count if requested', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/withrepeat.svc/Submissions?$top=1&$count=true")
          .expect(200)
          .then(({ body }) => {
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            delete body.value[0].__system.submissionDate;

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
              '@odata.nextLink': "http://localhost:8989/v1/projects/1/forms/withrepeat.svc/Submissions?%24count=true&%24skip=1",
              '@odata.count': 3,
              value: [{
                __id: "three",
                __system: {
                  // submissionDate is checked above,
                  submitterId: "5",
                  submitterName: "Alice",
                  encrypted: false
                },
                meta: { instanceID: "three" },
                name: "Chelsea",
                age: 38,
                children: {}
              }]
            });
          }))));

    it('should return encrypted frames', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
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
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted.svc/Submissions')
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the date for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              delete body.value[0].__system.submissionDate;
              body.value[1].__system.submissionDate.should.be.an.isoDate();
              delete body.value[1].__system.submissionDate;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/encrypted.svc/$metadata#Submissions',
                value: [{
                  __id: 'uuid:99b303d9-6494-477b-a30d-d8aae8867335',
                  __system: {
                    // submissionDate is checked above!
                    submitterId: '5',
                    submitterName: 'Alice',
                    encrypted: true
                  }
                }, {
                  __id: 'uuid:dcf4a151-5088-453f-99e6-369d67828f7a',
                  __system: {
                    // submissionDate is checked above!
                    submitterId: '5',
                    submitterName: 'Alice',
                    encrypted: true
                  }
                }]
              })
            })))));

    it('should limit and offset subtable results', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/withrepeat.svc/Submissions.children.child?$top=1&$skip=1")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': "http://localhost:8989/v1/projects/1/forms/withrepeat.svc/Submissions.children.child?%24skip=2",
              value: [{
                __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d',
                '__Submissions-id': 'two',
                name: 'Billy',
                age: 4
              }]
            });
          }))));

    it('should gracefully degrade on encrypted subtables', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions')
            .send(testData.instances.doubleRepeat.double.replace('</data>',
              '<encryptedXmlFile>x</encryptedXmlFile><base64EncryptedKey>y</base64EncryptedKey></data>'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions.children.child")
            .expect(200)
            .then(({ body }) => {
              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child'
              })
            })))));
  });
});

