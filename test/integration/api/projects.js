const appRoot = require('app-root-path');
const should = require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { QueryOptions } = require('../../../lib/util/db');
const { exhaust } = require(appRoot + '/lib/worker/worker');

describe.skip('api: /projects', () => {
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

    it('should not count deleted app users', testService((service) =>
      service.login('alice', (asAlice) =>
        Promise.all([
          asAlice.post(`/v1/projects/1/app-users`)
            .send({ displayName: 'test 1' })
            .expect(200)
            .then(({ body }) => asAlice.delete(`/v1/projects/1/app-users/${body.id}`)
              .expect(200)),
          asAlice.post(`/v1/projects/1/app-users`)
            .send({ displayName: 'test 2' })
            .expect(200)
        ])
          .then(() => asAlice.get('/v1/projects/1')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.appUsers.should.equal(1);
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
            body.verbs.length.should.be.greaterThan(34);
            body.verbs.should.containDeep([ 'user.password.invalidate', 'project.delete' ]);
          }))));

    it('should return verb information with extended metadata (bob)', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/projects/1')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.verbs.should.be.an.Array();
            body.verbs.length.should.be.lessThan(25);
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

    it('should return a keyId if managed encryption is active', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1')
              .expect(200)
              .then(({ body }) => { body.keyId.should.be.a.Number(); }),
            asAlice.get('/v1/projects/1')
              .set('X-Extended-Metadata', true)
              .expect(200)
              .then(({ body }) => { body.keyId.should.be.a.Number(); })
          ])))));

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
        asAlice.post('/v1/projects/1/forms?publish=true')
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

    it('should modify extant drafts', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200))
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.match(/<data id="simple" version="\[encrypted:[a-zA-Z0-9\+\/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9\+\/]{392}"\/><\/model>/);
              }),
            asAlice.get('/v1/projects/1/forms/simple/draft.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.match(/<data id="simple" version="\[encrypted:[a-zA-Z0-9\+\/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9\+\/]{392}"\/><\/model>/);
              })
          ])))));

    it('should modify only the draft if there is no published version', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/key')
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft.xml')
            .expect(200)
            .then(({ text }) => {
              text.should.match(/<data id="simple2" version="2\.1\[encrypted:[a-zA-Z0-9\+\/]{8}\]">/);
              text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9\+\/]{392}"\/><\/model>/);
            })))));

    it('should automatically enable subsequently created forms for encryption', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
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

  describe('/:id PUT', () => {
    it('should return notfound if the project does not exist', testService((service) =>
      service.put('/v1/projects/99')
        .set('Content-Type', 'application/json')
        .send({ name: 'New Test Name' })
        .expect(404)));

    it('should reject unless the user can update', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.put('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name' })
          .expect(403))));

    it('should fail if a required project field is not provided', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({ archived: true })
          .expect(400)
          .then(({ body }) => { body.code.should.equal(400.2); }))));

    it('should update project information', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({ name: 'New Test Name', archived: true })
          .expect(200)
          .then(() => asBob.get('/v1/projects/1')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Project();
              body.name.should.equal('New Test Name');
              body.archived.should.equal(true);
              body.updatedAt.should.be.a.recentIsoDate();
            }))
          .then(() => asBob.put('/v1/projects/1')
            .send({ name: 'Newer Name' })
            .expect(200))
          .then(() => asBob.get('/v1/projects/1')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Project();
              body.name.should.equal('Newer Name');
              should.not.exist(body.archived);
              body.updatedAt.should.be.a.recentIsoDate();
            })))));

    it('should return updated data with the PUT', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({ name: 'New Test Name', archived: true })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Project();
            body.name.should.equal('New Test Name');
            body.archived.should.equal(true);
            body.updatedAt.should.be.a.recentIsoDate();
          }))));

    it('should log the action in the audit log', testService((service, { Audit, Project }) =>
      service.login('alice', (asAlice) =>
        asAlice.put('/v1/projects/1')
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
            audit.get().details.should.eql({ data: { name: 'New Test Name', archived: null } });
          }))));

    ////////////////////////////////////////////////////////////////////////////////
    // updates with forms:

    it('should fail if the wrong number of forms is provided', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({ name: 'Default Project', forms: [] })
          .expect(501))));

    it('should fail if an unknown form is provided', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({
            name: 'Default Project',
            forms: [
              { xmlFormId: 'simple', name: 'Simple', state: 'open' },
              { xmlFormId: 'unknown', name: 'Unknown Form', state: 'closing' }
            ]
          })
          .expect(501))));

    it('should fail if the same form is provided twice', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({
            name: 'Default Project',
            forms: [
              { xmlFormId: 'simple', name: 'Simple', state: 'open' },
              { xmlFormId: 'simple', name: 'Unknown Form', state: 'closing' }
            ]
          })
          .expect(400)
          .then(({ body }) => { body.code.should.equal(400.8); }))));

    it('should fail if an invalid form state is given', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({
            name: 'Default Project',
            forms: [
              { xmlFormId: 'simple' },
              { xmlFormId: 'withrepeat' }
            ]
          })
          .expect(400)
          .then(({ body }) => { body.code.should.equal(400.8); }))));

    it('should update form details', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({
            name: 'Default Project',
            forms: [
              { xmlFormId: 'simple', name: 'New Simple', state: 'closed' },
              { xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing' }
            ]
          })
          .expect(200)
          .then(() => asBob.get('/v1/projects/1/forms')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body[0].should.be.a.Form();
              body[0].xmlFormId.should.equal('withrepeat');
              body[0].name.should.equal('New Repeat');
              body[0].state.should.equal('closing');
              body[1].should.be.a.Form();
              body[1].xmlFormId.should.equal('simple');
              body[1].name.should.equal('New Simple');
              body[1].state.should.equal('closed');
            })))));

    it('should log the action in the audit log', testService((service, { Audit, Project }) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Default Project',
            forms: [
              { xmlFormId: 'simple', name: 'New Simple', state: 'closed' },
              { xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing' }
            ]
          })
          .expect(200)
          .then(() => Promise.all([
            asBob.get('/v1/users/current').expect(200).then(({ body }) => body),
            Project.getById(1).then((o) => o.get())
              .then((project) => project.getAllForms()),
            Audit.get(new QueryOptions({ args: { action: 'form.update' } }))
          ]))
          .then(([ bob, forms, audits ]) => {
            audits.length.should.equal(2);

            const repeatAudit = audits.find((a) => a.acteeId === forms[0].acteeId);
            should.exist(repeatAudit);
            repeatAudit.actorId.should.equal(bob.id);
            repeatAudit.details.should.eql({ data: { name: 'New Repeat', state: 'closing' } });

            const simpleAudit = audits.find((a) => a.acteeId === forms[1].acteeId);
            should.exist(simpleAudit);
            simpleAudit.actorId.should.equal(bob.id);
            simpleAudit.details.should.eql({ data: { name: 'New Simple', state: 'closed' } });
          }))));

    ////////////////////////////////////////////////////////////////////////////////
    // updates with assignments:

    it('should reject if the roleId is not given', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/app-users')
          .send({ displayName: 'test app user' })
          .expect(200)
          .then(({ body }) => body)
          .then((fk) => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{ actorId: fk.id }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(400)
            .then(({ body }) => { body.code.should.equal(400.2); })))));

    it('should reject if the roleId is not recognized', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/app-users')
          .send({ displayName: 'test app user' })
          .expect(200)
          .then(({ body }) => body)
          .then((fk) => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{
                  roleId: 99,
                  actorId: fk.id
                }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(400)
            .then(({ body }) => { body.code.should.equal(400.14); })))));

    it('should reject if the actorId is not given', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/roles/app-user')
          .expect(200)
          .then(({ body }) => body.id)
          .then((appUserRoleId) => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{ roleId: appUserRoleId, }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(400)
            .then(({ body }) => { body.code.should.equal(400.2); })))));

    it('should reject if the actorId is not recognized', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/roles/app-user')
          .expect(200)
          .then(({ body }) => body.id)
          .then((appUserRoleId) => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{
                  roleId: appUserRoleId,
                  actorId: 99
                }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(400)
            .then(({ body }) => { body.code.should.equal(400.14); })))));

    it('should reject if the user lacks the verbs to be granted', testService((service) =>
      service.login('bob', (asBob) =>
        Promise.all([
          asBob.get('/v1/roles/admin')
            .expect(200)
            .then(({ body }) => body.id),
          asBob.post('/v1/projects/1/app-users')
            .send({ displayName: 'david' })
            .expect(200)
            .then(({ body }) => body)
        ])
          .then(([ adminRoleId, david ]) => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{
                  roleId: adminRoleId,
                  actorId: david.id
                }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(403)))));

    it('should create the requested assignments', testService((service) =>
      service.login('bob', (asBob) =>
        Promise.all([
          asBob.post('/v1/projects/1/app-users')
            .send({ displayName: 'test app user' })
            .expect(200)
            .then(({ body }) => body),
          asBob.get('/v1/roles/app-user')
            .expect(200)
            .then(({ body }) => body.id),
          asBob.get('/v1/roles/manager')
            .expect(200)
            .then(({ body }) => body.id)
        ])
          .then(([ fk, appUserRoleId, managerRoleId ]) => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{
                  roleId: appUserRoleId,
                  actorId: fk.id
                }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing',
                assignments: [{
                  roleId: managerRoleId,
                  actorId: fk.id
                }]
              }]
            })
            .expect(200)
            .then(() => Promise.all([
              asBob.get('/v1/projects/1/forms/simple/assignments')
                .expect(200)
                .then(({ body }) => { body.should.eql([{ roleId: appUserRoleId, actorId: fk.id }]); }),
              asBob.get('/v1/projects/1/forms/withrepeat/assignments')
                .expect(200)
                .then(({ body }) => { body.should.eql([{ roleId: managerRoleId, actorId: fk.id }]); })
            ]))))));

    it('should log the creation action in the audit log', testService((service, { Actor, Audit, Form }) =>
      service.login('bob', (asBob) =>
        Promise.all([
          asBob.post('/v1/projects/1/app-users')
            .send({ displayName: 'test app user' })
            .expect(200)
            .then(({ body }) => body),
          asBob.get('/v1/roles/app-user')
            .expect(200)
            .then(({ body }) => body.id)
        ])
          .then(([ fk, appUserRoleId ]) => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{
                  roleId: appUserRoleId,
                  actorId: fk.id
                }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(200)
            .then(() => Promise.all([
              asBob.get('/v1/users/current').expect(200).then(({ body }) => body),
              Actor.getById(fk.id).then((o) => o.get()),
              Form.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()),
              Audit.getLatestByAction('assignment.create').then((o) => o.get())
            ]))
            .then(([ bob, fullfk, form, audit ]) => {
              audit.actorId.should.equal(bob.id);
              audit.acteeId.should.equal(fullfk.acteeId);
              audit.details.should.eql({ roleId: appUserRoleId, grantedActeeId: form.acteeId });
            })))));

    it('should delete the requested assignments', testService((service) =>
      service.login('bob', (asBob) => asBob.post('/v1/projects/1/app-users')
        .send({ displayName: 'test app user' })
        .expect(200)
        .then(({ body }) => body)
        .then((fk) => Promise.all([
          asBob.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
            .expect(200),
          asBob.post(`/v1/projects/1/forms/withrepeat/assignments/manager/${fk.id}`)
            .expect(200)
        ])
          .then(() => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: []
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing',
                assignments: []
              }]
            })
            .expect(200)
            .then(() => Promise.all([
              asBob.get('/v1/projects/1/forms/simple/assignments')
                .expect(200)
                .then(({ body }) => { body.should.eql([]); }),
              asBob.get('/v1/projects/1/forms/withrepeat/assignments')
                .expect(200)
                .then(({ body }) => { body.should.eql([]); })
            ])))))));

    it('should not delete enketo formviewer assignments', testService((service, container) =>
      service.login('bob', (asBob) => asBob.post('/v1/projects/1/app-users')
        .send({ displayName: 'test app user' })
        .expect(200)
        .then(({ body }) => body)
        .then((fk) => Promise.all([
          asBob.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
            .expect(200),
          asBob.post(`/v1/projects/1/forms/withrepeat/assignments/manager/${fk.id}`)
            .expect(200),
          asBob.post(`/v1/projects/1/forms?publish=true`)
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')
            .expect(200)
        ])
          .then(() => exhaust(container))
          .then(() => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: []
              }, {
                xmlFormId: 'simple2', name: 'New New Simple', state: 'open',
                assignments: []
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing',
                assignments: []
              }]
            })
            .expect(200)
            .then(() => Promise.all([
              asBob.get('/v1/projects/1/forms/simple/assignments')
                .expect(200)
                .then(({ body }) => { body.should.eql([]); }),
              container.Form.getByProjectAndXmlFormId(1, 'simple2')
                .then((o) => o.get())
                .then(({ acteeId }) => container.Assignment.getByActeeId(acteeId))
                .then((result) => {
                  result.length.should.equal(1);
                }),
              asBob.get('/v1/projects/1/forms/withrepeat/assignments')
                .expect(200)
                .then(({ body }) => { body.should.eql([]); })
            ])))))));

    it('should not delete public link assignments', testService((service, container) =>
      service.login('bob', (asBob) => asBob.post('/v1/projects/1/forms/simple/public-links')
        .send({ displayName: 'test link' })
        .expect(200)
        .then(() => asBob.put('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Default Project',
            forms: [{
              xmlFormId: 'simple', name: 'New Simple', state: 'closed',
              assignments: []
            }, {
              xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing',
              assignments: []
            }]
          })
          .expect(200)
          .then(() => Promise.all([
            asBob.get('/v1/projects/1/forms/simple/assignments')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
              }),
            asBob.get('/v1/projects/1/forms/withrepeat/assignments')
              .expect(200)
              .then(({ body }) => { body.should.eql([]); })
          ]))))));

    it('should log the deletion action in the audit log', testService((service, { Actor, Audit, Project }) =>
      service.login('bob', (asBob) => asBob.post('/v1/projects/1/app-users')
        .send({ displayName: 'test app user' })
        .expect(200)
        .then(({ body }) => body)
        .then((fk) => asBob.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
          .expect(200)
          .then(() => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: []
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(200)
            .then(() => Promise.all([
              asBob.get('/v1/users/current').expect(200).then(({ body }) => body),
              asBob.get('/v1/roles/app-user').expect(200).then(({ body }) => body.id),
              Actor.getById(fk.id).then((o) => o.get()),
              Project.getById(1).then((o) => o.get())
                .then((project) => project.getFormByXmlFormId('simple')).then((o) => o.get()),
              Audit.getLatestByAction('assignment.delete').then((o) => o.get())
            ]))
            .then(([ bob, appUserRoleId, fullfk, form, audit ]) => {
              audit.actorId.should.equal(bob.id);
              audit.acteeId.should.equal(fullfk.acteeId);
              audit.details.should.eql({ roleId: appUserRoleId, revokedActeeId: form.acteeId });
            }))))));

    it('should leave assignments alone if no array is given', testService((service) =>
      service.login('bob', (asBob) => asBob.post('/v1/projects/1/app-users')
        .send({ displayName: 'test app user' })
        .expect(200)
        .then(({ body }) => body)
        .then((fk) => asBob.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
          .expect(200)
          .then(() => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed'
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(200)
            .then(() => asBob.get('/v1/projects/1/forms/simple/assignments')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].actorId.should.equal(fk.id);
              })))))));

    it('should leave assignments alone if there is no change', testService((service, { Audit }) =>
      service.login('bob', (asBob) => Promise.all([
        asBob.post('/v1/projects/1/app-users')
          .send({ displayName: 'test app user' })
          .expect(200)
          .then(({ body }) => body),
        asBob.get('/v1/roles/app-user').expect(200).then(({ body }) => body.id)
      ])
        .then(([ fk, appUserRoleId ]) => asBob.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
          .expect(200)
          .then(() => asBob.put('/v1/projects/1')
            .set('Content-Type', 'application/json')
            .send({
              name: 'Default Project',
              forms: [{
                xmlFormId: 'simple', name: 'New Simple', state: 'closed',
                assignments: [{ actorId: fk.id, roleId: appUserRoleId }]
              }, {
                xmlFormId: 'withrepeat', name: 'New Repeat', state: 'closing'
              }]
            })
            .expect(200)
            .then(() => Promise.all([
              asBob.get('/v1/projects/1/forms/simple/assignments')
                .expect(200)
                .then(({ body }) => {
                  body.length.should.equal(1);
                  body[0].actorId.should.equal(fk.id);
                }),
              Audit.getLatestByAction('assignment.delete')
                .then((o) => { o.isDefined().should.equal(false); })
            ])))))));
  });
});

