const should = require('should');
const { testService } = require('../setup');

describe('api: /projects', () => {
  describe('GET', () => {
    it('should reject unless the user can list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects').expect(403))));

    it('should return a list of projects', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.a.Project();
          }))));
  });

  describe('POST', () => {
    it('should reject unless the user can create', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'Test Project' })
          .expect(403))));

    it('should reject unless a name is provided', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({})
          .expect(400))));

    it('should create the given project', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'Test Project' })
          .expect(200)
          .then(({ body }) => {
            body.name.should.equal('Test Project');
            body.should.be.a.Project();
            return asAlice.get(`/v1/projects/${body.id}`).expect(200);
          }))));

    it('should create an audit log entry', testService((service, { Audit, Project, simply }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'Test Project' })
          .expect(200)
          .then(({ body }) => Promise.all([
            Audit.getLatestWhere({ action: 'project.create' }),
            asAlice.get('/v1/users/current')
          ])
            .then(([ audit, user ]) => {
              audit.isDefined().should.equal(true);
              audit.get().actorId.should.equal(user.body.id);
              return simply.getOneWhere('projects', { acteeId: audit.get().acteeId }, Project)
                .then((project) => {
                  project.isDefined().should.equal(true);
                  project.get().id.should.equal(body.id);
                });
            })))));
  });

  describe('/:id GET', () => {
    it('should return notfound if the project does not exist', testService((service) =>
      service.get('/v1/projects/99').expect(404)));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1').expect(403))));

    it('should return the default project', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1')
          .expect(200)
          .then(({ body }) => {
            body.id.should.equal(1);
            body.name.should.equal('Default Project');
            body.should.be.a.Project();
          }))));
  });

  describe('/:id PATCH', () => {
    it('should return notfound if the project does not exist', testService((service) =>
      service.patch('/v1/projects/99')
        .set('Content-Type', 'application/json')
        .send({ name: 'New Test Name' })
        .expect(404)));

    it('should reject unless the user can update', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name' })
          .expect(403))));

    it('should update the project name', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1')
            .expect(200)
            .then(({ body }) => {
              body.name.should.equal('New Test Name');
            })))));

    it('should log an audit record', testService((service, { Audit, Project }) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name' })
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/users/current').expect(200),
            Project.getById(1),
            Audit.getLatestWhere({ action: 'project.update' })
          ]))
          .then(([ user, project, audit ]) => {
            project.isDefined().should.equal(true);
            audit.isDefined().should.equal(true);

            audit.get().actorId.should.equal(user.body.id);
            audit.get().acteeId.should.equal(project.get().acteeId);
            audit.get().details.should.eql({ name: 'New Test Name' });
          }))));
  });

  describe('/:id DELETE', () => {
    it('should return notfound if the project does not exist', testService((service) =>
      service.delete('/v1/projects/99').expect(404)));

    it('should reject unless the user can update', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.delete('/v1/projects/1').expect(403))));

    it('should delete the project', testService((service, { Audit, Project }) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1').expect(404))
          .then(() => asAlice.get('/v1/projects')
            .expect(200)
            .then(({ body }) => body.should.eql([]))))));
  });
});

