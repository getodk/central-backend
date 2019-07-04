const should = require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: /projects', () => {
  describe('GET', () => {
    it('should return an empty array if not logged in', testService((service) =>
      service.get('/v1/projects')
        .expect(200)
        .then(({ body }) => { body.should.eql([]); })));

    it('should return an empty array if the user has no rights', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects')
          .expect(200)
          .then(({ body }) => { body.should.eql([]); }))));

    it('should return all projects for an administrator', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'Project Two' })
          .expect(200)
          .then(() => asAlice.get('/v1/projects')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body[0].should.be.a.Project();
              body[0].name.should.equal('Default Project');
              body[1].should.be.a.Project();
              body[1].name.should.equal('Project Two');
            })))));

    it('should return only granted projects for a non-administrator', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects').send({ name: 'Project Two' }).expect(200)
          .then(() => service.login('bob', (asBob) =>
            asBob.get('/v1/projects')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].should.be.a.Project();
                body[0].name.should.equal('Default Project');
              }))))));

    it('should only return each project once even if multiply assigned', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((aliceId) => asAlice.post('/v1/projects/1/assignments/manager/' + aliceId)
            .expect(200)
            .then(() => asAlice.get('/v1/projects')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].should.be.a.Project();
                body[0].name.should.equal('Default Project');
              }))))));

    it('should order projects appropriately', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'A Test Project', archived: true })
          .set('Content-Type', 'application/json')
          .expect(200)
          .then(() => asAlice.post('/v1/projects')
            .send({ name: 'Other Project', archived: true })
            .set('Content-Type', 'application/json')
            .expect(200)
            .then(() => asAlice.post('/v1/projects')
              .send({ name: 'Aardvark Project' })
              .set('Content-Type', 'application/json')
              .expect(200)
              .then(() => asAlice.get('/v1/projects')
                .expect(200)
                .then(({ body }) => {
                  body.length.should.equal(4);
                  body.map((p) => p.name).should.eql([
                    'Aardvark Project',
                    'Default Project',
                    'A Test Project',
                    'Other Project'
                  ]);
                  body[2].archived.should.equal(true);
                  body[3].archived.should.equal(true);
                })))))));

    it('should return extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
        asAlice.post(`/v1/projects/1/app-users`)
          .send({ displayName: 'test 1' })
          .expect(200),
        asAlice.post(`/v1/projects/1/app-users`)
          .send({ displayName: 'test 2' })
          .expect(200),
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200),
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.two)
          .set('Content-Type', 'application/xml')
          .expect(200),
        asAlice.post('/v1/projects')
          .send({ name: 'A Test Project' })
          .set('Content-Type', 'application/json')
          .expect(200)
      ])
        .then(() => asAlice.get('/v1/projects')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(2);
            body[0].should.be.an.ExtendedProject();
            body[1].should.be.an.ExtendedProject();

            body[0].name.should.equal('A Test Project');
            body[0].forms.should.equal(0);
            body[0].appUsers.should.equal(0);
            should.not.exist(body[0].lastSubmission);

            body[1].name.should.equal('Default Project');
            body[1].forms.should.equal(2);
            body[1].appUsers.should.equal(2);
            body[1].lastSubmission.should.be.a.recentIsoDate();
          })))));

    it('should return extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => asAlice.get('/v1/projects')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.an.ExtendedProject();
              body[0].name.should.equal('Default Project');
              body[0].forms.should.equal(1);
            })))));

    it('should order extended metadata projects appropriately', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'A Test Project', archived: true })
          .set('Content-Type', 'application/json')
          .expect(200)
          .then(() => asAlice.post('/v1/projects')
            .send({ name: 'Other Project', archived: true })
            .set('Content-Type', 'application/json')
            .expect(200)
            .then(() => asAlice.post('/v1/projects')
              .send({ name: 'Aardvark Project' })
              .set('Content-Type', 'application/json')
              .expect(200)
              .then(() => asAlice.get('/v1/projects')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body }) => {
                  body.length.should.equal(4);
                  body.map((p) => p.name).should.eql([
                    'Aardvark Project',
                    'Default Project',
                    'A Test Project',
                    'Other Project'
                  ]);
                  body[2].archived.should.equal(true);
                  body[3].archived.should.equal(true);
                })))))));
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
              audit.get().details.should.eql({ data: { name: 'Test Project' } });
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

    it('should reject if id is non-numeric', testService((service) =>
      service.login('alice', (asAlice) =>
      asAlice.get('/v1/projects/1a')
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.11)}))));

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

    it('should return extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.should.be.an.ExtendedProject();
            body.forms.should.equal(2);
            should.not.exist(body.lastSubmission);
          })
          .then(() => Promise.all([
            asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'application/xml')
              .expect(200),
            asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.two)
              .set('Content-Type', 'application/xml')
              .expect(200)
          ]))
          .then(() => asAlice.get('/v1/projects/1')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.should.be.an.ExtendedProject();
              body.forms.should.equal(2);
              body.lastSubmission.should.be.a.recentIsoDate();
            })))));

    it('should not return verb information unless extended metata is requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1')
          .expect(200)
          .then(({ body }) => { should.not.exist(body.verbs); }))));

    it('should return verb information with extended metadata (alice)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.verbs.should.be.an.Array();
            body.verbs.length.should.be.greaterThan(30);
            body.verbs.should.containDeep([ 'user.password.invalidate', 'project.delete' ]);
          }))));

    it('should return verb information with extended metadata (bob)', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/projects/1')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.verbs.should.be.an.Array();
            body.verbs.length.should.be.lessThan(20);
            body.verbs.should.containDeep([ 'assignment.create', 'project.delete' ]);
            body.verbs.should.not.containDeep([ 'project.create' ]);
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

    it('should return a sensible error given a nonboolean value', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name', archived: 'aaa' })
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.11);
            body.details.value.should.equal('aaa');
            body.details.expected.includes('boolean').should.equal(true);
          }))));

    it('should update the project details and return the new project data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name', archived: true })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Project();
            body.name.should.equal('New Test Name');
            body.archived.should.equal(true);
          })
          // paranoia:
          .then(() => asAlice.get('/v1/projects/1')
            .expect(200)
            .then(({ body }) => {
              body.name.should.equal('New Test Name');
              body.archived.should.equal(true);
            })))));

    it('should log the action in the audit log', testService((service, { Audit, Project }) =>
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
            audit.get().details.should.eql({ data: { name: 'New Test Name' } });
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

  describe('/:id/key POST', () => {
    it('should reject if the user cannot update the project', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.post('/v1/projects/1/key').expect(403))));

    it('should reject if no passphrase is provided', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: '' })
          .expect(400))));

    it('should reject if managed encryption is already active', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(409)))));

    it('should modify extant forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.match(/<data id="simple" version="\[encrypted:[a-zA-Z0-9\+\/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9\+\/]{392}"\/><\/model>/);
              }),
            asAlice.get('/v1/projects/1/forms/withrepeat.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.match(/<data id="withrepeat" orx:version="1.0\[encrypted:[a-zA-Z0-9\+\/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9\+\/]{392}"\/><\/model>/);
              })
          ])))));

    it('should not modify already-encrypted forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted.xml')
            .expect(200)
            .then(({ text }) => {
              text.indexOf('<data id="encrypted" version="working3">').should.be.greaterThan(-1);
              text.indexOf('<submission base64RsaPublicKey="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyYh7bSui/0xppQ+J3i5xghfao+559Rqg9X0xNbdMEsW35CzYUfmC8sOzeeUiE4pG7HIEUmiJal+mo70UMDUlywXj9z053n0g6MmtLlUyBw0ZGhEZWHsfBxPQixdzY/c5i7sh0dFzWVBZ7UrqBc2qjRFUYxeXqHsAxSPClTH1nW47Mr2h4juBLC7tBNZA3biZA/XTPt//hAuzv1d6MGiF3vQJXvFTNdfsh6Ckq4KXUsAv+07cLtON4KjrKhqsVNNGbFssTUHVL4A9N3gsuRGt329LHOKBxQUGEnhMM2MEtvk4kaVQrgCqpk1pMU/4HlFtRjOoKdAIuzzxIl56gNdRUQIDAQAB"/>').should.be.greaterThan(-1);
            })))));

    it('should automatically enable subsequently created forms for encryption', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple2)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(({ body }) => {
              body.version.should.match(/^2\.1\[encrypted:[a-zA-Z0-9+/]{8}\]$/);
            }))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.xml')
            .expect(200)
            .then(({ text }) => {
              text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9+/]{392}"\/>/);
            })))));

    it('should log the action in the audit log', testService((service, { Audit, Project, User }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => Promise.all([
            Project.getById(1).then((o) => o.get()),
            User.getByEmail('alice@opendatakit.org').then((o) => o.get()),
            Audit.getLatestWhere({ action: 'project.update' }).then((o) => o.get())
          ]))
          .then(([ project, alice, log ]) => {
            log.actorId.should.equal(alice.actor.id);
            log.acteeId.should.equal(project.acteeId);
            log.details.should.eql({ encrypted: true });
          }))));
  });
});

