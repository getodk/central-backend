const { testService } = require('../setup');
const testData = require('../../data/xml');

const viewer = (f) => (service) =>
  service.login('chelsea', (asChelsea) =>
    asChelsea.get('/v1/users/current')
      .expect(200)
      .then(({ body }) => body)
      .then((chelsea) => service.login('alice', (asAlice) =>
        asAlice.post(`/v1/projects/1/assignments/viewer/${chelsea.id}`)
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
      .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.binaryType)
        .set('Content-Type', 'application/xml')
        .expect(200))
      .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions')
        .send(testData.instances.binaryType.one)
        .set('Content-Type', 'application/xml')
        .expect(200))
      .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/bone/attachments/my_file1.mp4')
        .send('content')
        .expect(200))
      .then(() => f(service)));

describe('project viewer role', () => {
  it('should be able to list projects it can access', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects')
        .send({ name: 'Project Two' })
        .expect(200)
        .then(() => service)
        .then(viewer((asViewer) => asViewer.get('/v1/projects')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.a.Project();
            body[0].name.should.equal('Default Project');
          }))))));

  it('should be able to get basic project details', testService(viewer((asViewer) =>
    asViewer.get('/v1/projects/1')
      .expect(200)
      .then(({ body }) => { body.should.be.a.Project(); }))));

  it('should not be able to update project details', testService(viewer((asViewer) =>
    asViewer.patch('/v1/projects/1')
      .send({ name: 'New Name' })
      .expect(403))));

  it('should be able to list all forms in a project', testService(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms?publish=true')
      .expect(200)
      .then(({ body }) => {
        body.length.should.equal(2);
        body.forEach((form) => form.should.be.a.Form());
        body[0].xmlFormId.should.equal('simple');
        body[1].xmlFormId.should.equal('withrepeat');
      }))));

  it('should be able to get form detail', testService(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/simple')
      .expect(200)
      .then(({ body }) => { body.should.be.a.Form(); }))));

  it('should not be able to update form details', testService(viewer((asViewer) =>
    asViewer.patch('/v1/projects/1/forms/simple')
      .send({ name: 'New Name' })
      .expect(403))));

  it('should not be able to create new forms', testService(viewer((asViewer) =>
    asViewer.post('/v1/projects/1/forms')
      .send(testData.forms.withAttachments)
      .set('Content-Type', 'text/xml')
      .expect(403))));

  it('should be able to list form submissions', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/simple/submissions')
      .expect(200)
      .then(({ body }) => {
        body.length.should.equal(2);
        body[0].instanceId.should.equal('two');
        body[1].instanceId.should.equal('one');
      })))));

  it('should not be able to create new submissions', testService(viewer((asViewer) =>
    asViewer.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one)
      .set('Content-Type', 'text/xml')
      .expect(403))));

  it('should be able to download submissions', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/simple/submissions.csv.zip')
      .expect(200)))));

  it('should be able to get submission detail', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/simple/submissions/one')
      .expect(200)
      .then(({ body }) => {
        body.should.be.a.Submission();
        body.instanceId.should.equal('one');
      })))));

  it('should be able to fetch a submission attachment', testService(withSubmissions(viewer((asViewer) =>
    asViewer.get('/v1/projects/1/forms/binaryType/submissions/bone/attachments/my_file1.mp4')
      .expect(200)
      .then(({ text }) => { text.should.equal('content'); })))));


});

