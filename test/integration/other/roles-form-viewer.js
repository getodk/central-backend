const should = require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const viewer = (f) => (service) =>
  service.login('chelsea', (asChelsea) =>
    asChelsea.get('/v1/users/current')
      .expect(200)
      .then(({ body }) => body)
      .then((chelsea) => service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/forms/simple/assignments/form-viewer/${chelsea.id}`)
          .expect(200)
          .then(() => f(asChelsea, chelsea)))));

const withSubmissions = (f) => (service) =>
  service.login('alice', (asAlice) =>
    asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one)
      .set('Content-Type', 'application/xml')
      .expect(200)
      .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.two)
        .set('Content-Type', 'application/xml')
        .expect(200))
      .then(() => asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.binaryType)
        .set('Content-Type', 'application/xml')
        .expect(200))
      .then(() => service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current')
        .expect(200)
        .then(({ body }) => body)
        .then((chelsea) => asAlice.post(`/v1/projects/1/forms/binaryType/assignments/form-viewer/${chelsea.id}`)
          .expect(200))))
      .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
        .send(testData.instances.binaryType.one)
        .set('Content-Type', 'application/xml')
        .expect(200))
      .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/one/attachments/my_file1.mp4')
        .send('content')
        .expect(200))
      .then(() => f(service)));

describe('form viewer role', () => {
  it('should not be able to list project containing form', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects')
        .send({ name: 'Project Two' })
        .expect(200)
        .then(() => service)
        .then(viewer((asViewer) => asViewer.get('/v1/projects')
          .expect(200)
          .then(({ body }) => body.length.should.equal(0)))))));

  it('should not be able to get basic project details', testService(viewer((asViewer) =>
    asViewer.get('/v1/projects/1')
      .expect(403))));

  it('should not be able to update project details', testService(viewer((asViewer) =>
    asViewer.patch('/v1/projects/1')
      .send({ name: 'New Name' })
      .expect(403))));

  it('should not be able to list all forms in a project', testService(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms')
      .expect(403))));

  it('should be able to get form detail', testService(withSubmissions(viewer((asViewer) =>
    Promise.all(['simple', 'binaryType'].map((form) =>
      asViewer.get(`/v1/projects/1/forms/${form}`)
        .expect(200)
        .then(({ body }) => { body.should.be.a.Form(); })))))));

  it('should not be able to update form details', testService(viewer((asViewer) =>
    asViewer.patch('/v1/projects/1/forms/simple')
      .send({ name: 'New Name' })
      .expect(403))));

  it('should not be able to create new forms', testService(viewer((asViewer) =>
    asViewer.post('/v1/projects/1/forms')
      .send(testData.forms.withAttachments)
      .set('Content-Type', 'text/xml')
      .expect(403))));

  it('should not be able to get detail of a form to which it has no assignment', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simple2)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => service)
        .then(viewer((asViewer) => asViewer.get('/v1/projects/1/forms/simple2')
          .expect(403))))));

  it('should not be able to list form submissions', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/simple/submissions')
      .expect(403)))));

  it('should not be able to create new submissions', testService(viewer((asViewer) =>
    asViewer.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one)
      .set('Content-Type', 'text/xml')
      .expect(403))));

  it('should not be able to download submissions', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/simple/submissions.csv.zip')
      .expect(403)))));

  it('should not be able to get submission detail', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/simple/submissions/one')
      .expect(403)))));

  it('should not be able to fetch a submission attachment', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/binaryType/submissions/one/attachments/my_file1.mp4')
      .expect(403)))));

});

