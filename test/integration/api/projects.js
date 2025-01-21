const appRoot = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { QueryOptions } = require('../../../lib/util/db');
const { Actor } = require('../../../lib/model/frames');
const { createConflict } = require('../fixtures/scenarios');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');

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

    it('should return the correct project verbs when multiply assigned', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: alice } = await asAlice.get('/v1/users/current')
        .expect(200);
      await asAlice.post('/v1/projects/1/assignments/manager/' + alice.id)
        .expect(200);
      const { body: project } = await asAlice.get('/v1/projects/1')
        .set('X-Extended-Metadata', 'true')
        .expect(200);
      const { body: admin } = await asAlice.get('/v1/roles/admin').expect(200);
      project.verbs.should.eqlInAnyOrder(admin.verbs);
      project.should.be.a.Project();
      project.name.should.equal('Default Project');
    }));

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

    it('should return extended metadata if requested', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => Promise.all([
            asAlice.post('/v1/projects/1/app-users')
              .send({ displayName: 'test 1' })
              .expect(200),
            asAlice.post('/v1/projects/1/app-users')
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
            asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one)
              .set('Content-Type', 'application/xml')
              .expect(200),
            asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.two)
              .set('Content-Type', 'application/xml')
              .expect(200),
            asAlice.post('/v1/projects')
              .send({ name: 'A Test Project' })
              .set('Content-Type', 'application/json')
              .expect(200)
          ])
            .then(() => exhaust(container))
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
                should.not.exist(body[0].lastEntity);

                body[1].name.should.equal('Default Project');
                body[1].forms.should.equal(3);
                body[1].appUsers.should.equal(2);
                body[1].lastSubmission.should.be.a.recentIsoDate();

                body[1].datasets.should.equal(1);
                body[1].lastEntity.should.be.a.recentIsoDate();
              }))))));

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

    it('should create the given project with a description', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'Test Project', description: 'Test Description' })
          .expect(200)
          .then(({ body }) => {
            body.name.should.equal('Test Project');
            body.description.should.equal('Test Description');
            body.should.be.a.Project();
            return asAlice.get(`/v1/projects/${body.id}`).expect(200);
          }))));

    it('should create an audit log entry', testService((service, { Audits, one }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .set('Content-Type', 'application/json')
          .send({ name: 'Test Project' })
          .expect(200)
          .then(({ body }) => Promise.all([
            Audits.getLatestByAction('project.create'),
            asAlice.get('/v1/users/current')
          ])
            .then(([ audit, user ]) => {
              audit.isDefined().should.equal(true);
              audit.get().actorId.should.equal(user.body.id);
              audit.get().details.data.name.should.equal('Test Project');
              return one(sql`select * from projects where "acteeId"=${audit.get().acteeId}`)
                .then((project) => { project.id.should.equal(body.id); });
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
            body.code.should.equal(400.11);
          }))));

    it('should reject if id is too big', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/10000000000')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.22);
          }))));

    it('should reject if id is too small', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/-10000000000')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.22);
          }))));

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

    it('should return extended metadata if requested', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.should.be.an.ExtendedProject();
          body.forms.should.equal(2);
          body.datasets.should.equal(0);
          should.not.exist(body.lastSubmission);
        });

      await Promise.all([
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200),
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.two)
          .set('Content-Type', 'application/xml')
          .expect(200)
      ]);

      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.should.be.an.ExtendedProject();
          body.forms.should.equal(3);
          body.datasets.should.equal(0); // Form that created dataset is not published yet
          body.lastSubmission.should.be.a.recentIsoDate();
        });

      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish')
        .expect(200);

      await asAlice.get('/v1/projects/1')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          body.datasets.should.equal(1);
        });

    }));

    it('should not count deleted app users', testService((service) =>
      service.login('alice', (asAlice) =>
        Promise.all([
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'test 1' })
            .expect(200)
            .then(({ body }) => asAlice.delete(`/v1/projects/1/app-users/${body.id}`)
              .expect(200)),
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'test 2' })
            .expect(200)
        ])
          .then(() => asAlice.get('/v1/projects/1')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.appUsers.should.equal(1);
            })))));

    it('should not return verb information unless extended meta data is requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1')
          .expect(200)
          .then(({ body }) => { should.not.exist(body.verbs); }))));

    it('should return verb information with extended metadata (alice)', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: project } = await asAlice.get('/v1/projects/1')
        .set('X-Extended-Metadata', 'true')
        .expect(200);
      project.verbs.should.be.an.Array();
      const { body: admin } = await asAlice.get('/v1/roles/admin').expect(200);
      project.verbs.should.eql(admin.verbs);
      project.verbs.should.containDeep([ 'user.password.invalidate', 'project.delete' ]);
    }));

    it('should return verb information with extended metadata (bob)', testService(async (service) => {
      const asBob = await service.login('bob');
      const { body: project } = await asBob.get('/v1/projects/1')
        .set('X-Extended-Metadata', 'true')
        .expect(200);
      project.verbs.should.be.an.Array();
      const { body: manager } = await asBob.get('/v1/roles/manager')
        .expect(200);
      project.verbs.should.eql(manager.verbs);
      project.verbs.should.containDeep([ 'assignment.create', 'project.delete', 'dataset.list' ]);
      project.verbs.should.not.containDeep([ 'project.create' ]);
    }));

    it('should return verb information with extended metadata (data collector only)', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => asAlice.post(`/v1/projects/1/assignments/formfill/${chelseaId}`)
              .expect(200))
            .then(() => asChelsea.get('/v1/projects/1')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.verbs.should.eqlInAnyOrder([
                  // following verbs from role: formfill
                  'project.read',
                  'open_form.list',
                  'open_form.read',
                  'submission.create',
                ]);
              }))))));

    it('should return verb information with extended metadata (chelsea with two roles)', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => Promise.all([
              asAlice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200),
              asAlice.post(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200),
            ]))
            .then(() => asChelsea.get('/v1/projects/1')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                body.verbs.should.eqlInAnyOrder([
                  // following roles from formfill + viewer:
                  'project.read',
                  // following roles from formfill only:
                  'open_form.list',
                  'open_form.read',
                  'submission.create',
                  // following roles from viewer only:
                  'form.list',
                  'form.read',
                  'submission.read',
                  'submission.list',
                  'dataset.list',
                  'dataset.read',
                  'entity.list',
                  'entity.read'
                ]);
              }))))));
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
          .send({ name: 'New Test Name', archived: true, description: 'New Description' })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Project();
            body.name.should.equal('New Test Name');
            body.description.should.equal('New Description');
            body.archived.should.equal(true);
          })
          // paranoia:
          .then(() => asAlice.get('/v1/projects/1')
            .expect(200)
            .then(({ body }) => {
              body.name.should.equal('New Test Name');
              body.description.should.equal('New Description');
              body.archived.should.equal(true);
            })))));

    it('should update the project description', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ description: 'new project description' })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Project();
            body.description.should.equal('new project description');
          })
          .then(() => asAlice.get('/v1/projects/1')
            .expect(200)
            .then(({ body }) => {
              body.description.should.equal('new project description');
            })))));

    it('should log the action in the audit log', testService((service, { Audits, Projects }) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name' })
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/users/current').expect(200),
            Projects.getById(1),
            Audits.getLatestByAction('project.update')
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

    it('should reject unless the user can delete', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.delete('/v1/projects/1').expect(403))));

    it('should delete the project', testService((service) =>
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

    it('should reject if passphrase is too short', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'x' })
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
                text.should.match(/<data id="simple" version="\[encrypted:[a-zA-Z0-9+/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9+/]{392}"\/><\/model>/);
              }),
            asAlice.get('/v1/projects/1/forms/withrepeat.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.match(/<data id="withrepeat" orx:version="1.0\[encrypted:[a-zA-Z0-9+/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9+/]{392}"\/><\/model>/);
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
                text.should.match(/<data id="simple" version="\[encrypted:[a-zA-Z0-9+/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9+/]{392}"\/><\/model>/);
              }),
            asAlice.get('/v1/projects/1/forms/simple/draft.xml')
              .expect(200)
              .then(({ text }) => {
                text.should.match(/<data id="simple" version="\[encrypted:[a-zA-Z0-9+/]{8}\]">/);
                text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9+/]{392}"\/><\/model>/);
              })
          ])))));

    it('should reuse the draft token and enketoId of an existing draft', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms/simple/draft').expect(200);
      const { body: draft1 } = await asAlice.get('/v1/projects/1/forms/simple/draft')
        .expect(200);
      should.exist(draft1.draftToken);
      should.exist(draft1.enketoId);
      await asAlice.post('/v1/projects/1/key')
        .send({ passphrase: 'supersecret' })
        .expect(200);
      const { body: draft2 } = await asAlice.get('/v1/projects/1/forms/simple/draft')
        .expect(200);
      should(draft2.draftToken).equal(draft1.draftToken);
      should(draft2.enketoId).equal(draft1.enketoId);
    }));

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
              text.should.match(/<data id="simple2" version="2\.1\[encrypted:[a-zA-Z0-9+/]{8}\]">/);
              text.should.match(/<submission base64RsaPublicKey="[a-zA-Z0-9+/]{392}"\/><\/model>/);
            })))));

    it('should purge the unneeded form defs being replaced when encrypted', testService((service, { oneFirst }) => {
      const countDraftDefsQuery = sql`
        select count(*)
        from form_defs as fd
        join forms as f on fd."formId" = f.id
        where fd."publishedAt" is null`;

      return service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/draft') // make a draft of a published form
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms') // make a new form that only has a draft
            .send(testData.forms.simple2)
            .set('Content-Type', 'application/xml')
            .expect(200))
          .then(() => oneFirst(countDraftDefsQuery))
          .then((initialCount) => asAlice.post('/v1/projects/1/key') // turn on managed encryption
            .send({ passphrase: 'supersecret', hint: 'it is a secret' })
            .expect(200)
            .then(() => oneFirst(countDraftDefsQuery)
              .then((count) => {
                count.should.equal(initialCount);
              }))));
    }));

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

    it('should delete draft submissions on project encryption', testService(async (service) => {

      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.simple2)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple2/draft/submissions')
        .send(testData.instances.simple2.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/key')
        .send({ passphrase: 'supersecret', hint: 'it is a secret' })
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/simple2/draft')
        .set('X-Extended-Metadata', 'true')
        .then(({ body }) => {
          body.submissions.should.be.eql(0);
        });
    }));

    it('should not delete live submissions on project encryption', testService(async (service) => {

      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/key')
        .send({ passphrase: 'supersecret', hint: 'it is a secret' })
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/simple')
        .set('X-Extended-Metadata', 'true')
        .then(({ body }) => {
          body.submissions.should.be.eql(1);
        });
    }));


    it('should log the action in the audit log', testService((service, { Audits, Projects, Users }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret' })
          .expect(200)
          .then(() => Promise.all([
            Projects.getById(1).then((o) => o.get()),
            Users.getByEmail('alice@getodk.org').then((o) => o.get()),
            Audits.getLatestByAction('project.update').then((o) => o.get())
          ]))
          .then(([ project, alice, log ]) => {
            log.actorId.should.equal(alice.actor.id);
            log.acteeId.should.equal(project.acteeId);
            log.details.should.eql({ data: { keyId: project.keyId } });
          }))));

    it('should not throw form warnings', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/draft?ignoreWarnings=true')
        .send(testData.forms.simple.replace(/age/g, 'address'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/key')
        .send({ passphrase: 'supersecret', hint: 'it is a secret' })
        .expect(200);

    }));
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

    it('should log the action in the audit log', testService((service, { Audits, Projects }) =>
      service.login('alice', (asAlice) =>
        asAlice.put('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({ name: 'New Test Name' })
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/users/current').expect(200),
            Projects.getById(1),
            Audits.getLatestByAction('project.update')
          ]))
          .then(([ user, project, audit ]) => {
            project.isDefined().should.equal(true);
            audit.isDefined().should.equal(true);

            audit.get().actorId.should.equal(user.body.id);
            audit.get().acteeId.should.equal(project.get().acteeId);
            audit.get().details.should.eql({ data: { name: 'New Test Name', archived: null, description: null } });
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
              { xmlFormId: 'simple', state: 'closed' },
              { xmlFormId: 'withrepeat', state: 'closing' }
            ]
          })
          .expect(200)
          .then(() => asBob.get('/v1/projects/1/forms')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body[0].should.be.a.Form();
              body[0].xmlFormId.should.equal('simple');
              body[0].state.should.equal('closed');
              body[1].should.be.a.Form();
              body[1].xmlFormId.should.equal('withrepeat');
              body[1].state.should.equal('closing');
            })))));

    it('should not allow changing non-writable form details', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .send({
            name: 'Default Project',
            forms: [
              { xmlFormId: 'simple', name: 'New Simple', state: 'closed' },
            ]
          })
          .expect(501)))); // 501 not implemented

    it('should log the action in the audit log', testService((service, { Audits, Forms, Projects, Auth }) =>
      service.login('bob', (asBob) =>
        asBob.put('/v1/projects/1')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Default Project',
            forms: [
              { xmlFormId: 'simple', state: 'closed' },
              { xmlFormId: 'withrepeat', state: 'closing' }
            ]
          })
          .expect(200)
          .then(() => Promise.all([
            asBob.get('/v1/users/current').expect(200).then(({ body }) => body),
            Audits.get(new QueryOptions({ args: { action: 'form.update' } }))
          ]))
          .then(async ([ bob, audits ]) => {
            const actor = new Actor(bob);
            const forms = await Projects.getById(1).then((o) => o.get())
              .then((project) => Forms.getByProjectId(Auth.by(actor), project.id));

            audits.length.should.equal(2);

            const simpleAudit = audits.find((a) => a.acteeId === forms[0].acteeId);
            should.exist(simpleAudit);
            simpleAudit.actorId.should.equal(bob.id);
            simpleAudit.details.should.eql({ data: { state: 'closed' } });

            const repeatAudit = audits.find((a) => a.acteeId === forms[1].acteeId);
            should.exist(repeatAudit);
            repeatAudit.actorId.should.equal(bob.id);
            repeatAudit.details.should.eql({ data: { state: 'closing' } });
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

    it('should log the creation action in the audit log', testService((service, { Actors, Audits, Forms }) =>
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
              Actors.getById(fk.id).then((o) => o.get()),
              Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()),
              Audits.getLatestByAction('field_key.assignment.create').then((o) => o.get())
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
          asBob.post('/v1/projects/1/forms?publish=true')
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
              container.Forms.getByProjectAndXmlFormId(1, 'simple2')
                .then((o) => o.get())
                .then(({ acteeId }) => container.Assignments.getByActeeId(acteeId))
                .then((result) => {
                  result.length.should.equal(1);
                }),
              asBob.get('/v1/projects/1/forms/withrepeat/assignments')
                .expect(200)
                .then(({ body }) => { body.should.eql([]); })
            ])))))));

    it('should not delete public link assignments', testService((service) =>
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

    it('should log the deletion action in the audit log', testService((service, { Actors, Audits, Forms, Projects }) =>
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
              Actors.getById(fk.id).then((o) => o.get()),
              Projects.getById(1).then((o) => o.get())
                // eslint-disable-next-line no-multi-spaces
                .then((project) => Forms.getByProjectAndXmlFormId(project.id,  'simple')).then((o) => o.get()),
              Audits.getLatestByAction('field_key.assignment.delete').then((o) => o.get())
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

    it('should leave assignments alone if there is no change', testService((service, { Audits }) =>
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
              Audits.getLatestByAction('assignment.delete')
                .then((o) => { o.isDefined().should.equal(false); })
            ])))))));
  });
});

// Nested extended forms
describe('api: /projects?forms=true', () => {
  describe('GET', () => {
    it('should return projects with verbs and nested extended forms', testService(async (service) => {
      const asAlice = await service.login('alice');
      const { body: projects } = await asAlice.get('/v1/projects?forms=true')
        .expect(200);
      projects.length.should.equal(1);
      projects[0].should.be.a.Project();
      const { body: admin } = await asAlice.get('/v1/roles/admin').expect(200);
      projects[0].verbs.should.eqlInAnyOrder(admin.verbs);
      const { formList } = projects[0];
      formList.length.should.equal(2);
      const form = formList[0];
      form.should.be.a.ExtendedForm();
      form.name.should.equal('Simple');
      form.reviewStates.received.should.equal(0);
    }));

    it('should return projects with datasets', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects?datasets=true')
        .expect(200)
        .then(({ body }) => {
          body[0].datasetList.length.should.equal(1);
          body[0].datasetList[0].name.should.equal('people');
          body[0].datasetList[0].should.be.an.ExtendedDataset();
        });
    }));

    it('should return projects with forms and datasets', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects?datasets=true&forms=true')
        .expect(200)
        .then(({ body }) => {
          body[0].datasetList.length.should.equal(1);
          body[0].formList.length.should.equal(3);
        });
    }));

    it('should not return projects/forms not assigned to user', testService((service) =>
      service.login('chelsea', (asChelsea) => asChelsea.get('/v1/projects?forms=true')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(0);
        }))));

    it('should not return projects/datasets not assigned to user', testService(async (service) => {
      const asAlice = await service.login('alice');
      const asChelsea = await service.login('chelsea');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asChelsea.get('/v1/projects?datasets=true')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(0);
        });
    }));

    it('should return all forms including drafts to managers and above', testService((service) =>
      service.login('alice', (asAlice) => asAlice.post('/v1/projects/1/forms')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200)
        .then(() => service.login('bob', (asBob) => asBob.get('/v1/projects?forms=true')
          .expect(200)
          .then(({ body }) => {
            const { formList } = body[0];
            formList.length.should.equal(3);
          }))))));

    it('should not return draft forms to data collectors', testService((service, { Users }) =>
      service.login('alice', (asAlice) => asAlice.post('/v1/projects/1/forms')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType)
        .expect(200)
        .then(() => Users.getByEmail('chelsea@getodk.org').then((o) => o.get()))
        .then((chelsea) => asAlice.post(`/v1/projects/1/assignments/formfill/${chelsea.actorId}`))
        .then(() => service.login('chelsea', (asChelsea) => asChelsea.get('/v1/projects?forms=true')
          .expect(200)
          .then(({ body }) => {
            const { formList } = body[0];
            formList.length.should.equal(2);
          }))))));

    it('should not return datasets to data collectors', testService(async (service, { Users }) => {
      const asAlice = await service.login('alice');
      const asChelsea = await service.login('chelsea');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const chelsea = await Users.getByEmail('chelsea@getodk.org').then((o) => o.get());
      await asAlice.post(`/v1/projects/1/assignments/formfill/${chelsea.actorId}`);

      await asChelsea.get('/v1/projects?datasets=true')
        .expect(200)
        .then(({ body }) => {
          body[0].datasetList.length.should.equal(0);
        });
    }));

    // project 1: 2 published forms, bob = manager
    // project 2: 1 published, 1 draft, bob = data collector
    it('should return multiple projects with forms', testService((service, { Users }) =>
      service.login('alice', (asAlice) => asAlice.post('/v1/projects')
        .set('Content-Type', 'application/json')
        .send({ name: 'Another Project' })
        .expect(200)
        .then(({ body }) => asAlice.post(`/v1/projects/${body.id}/forms?publish=true`)
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simple2)
          .expect(200)
          .then(() => asAlice.post(`/v1/projects/${body.id}/forms`)
            .set('Content-Type', 'application/xml')
            .send(testData.forms.binaryType)
            .expect(200))
          .then(() => Users.getByEmail('bob@getodk.org').then((o) => o.get()))
          .then((bob) => asAlice.post(`/v1/projects/${body.id}/assignments/formfill/${bob.actorId}`)))
        .then(() => service.login('bob', (asBob) =>
          Promise.all([
            asBob.get('/v1/projects?forms=true').expect(200),
            asBob.get('/v1/roles/manager').expect(200),
            asBob.get('/v1/roles/formfill').expect(200)
          ])
            .then(([{ body }, { body: manager }, { body: formfill }]) => {
              body.length.should.equal(2);
              // First project
              body[0].formList.length.should.equal(2);
              body[0].verbs.should.eqlInAnyOrder(manager.verbs);
              // Second project
              body[1].formList.length.should.equal(1);
              body[1].verbs.should.eqlInAnyOrder(formfill.verbs);
              body[1].formList[0].name.should.equal('Simple 2');
            }))))));

    it('should set project data from formList even on non-extended projects', testService((service) =>
      service.login('alice', (asAlice) => asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.two)
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.get('/v1/projects?forms=true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            const project = body[0];
            project.should.be.a.Project();
            project.forms.should.equal(2);
            should.exist(project.lastSubmission);
            const form = body[0].formList[0];
            form.should.be.a.ExtendedForm();
            form.name.should.equal('Simple');
            form.reviewStates.received.should.equal(2);
          })))));

    it('should set project data from datasetList even on non-extended projects', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.multiPropertyEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets')
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111aaa',
          label: 'Johnny Doe',
          data: {
            first_name: 'Johnny',
            age: '22'
          }
        })
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/foo/entities')
        .send({
          uuid: '12345678-1234-4123-8234-111111111bbb',
          label: 'Johnny Doe',
          data: {
            b_q1: 'Johnny'
          }
        })
        .expect(200);

      await createConflict(asAlice, container);

      await asAlice.get('/v1/projects?datasets=true')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          const project = body[0];
          project.should.be.a.Project();
          project.datasets.should.equal(2);
          project.lastEntity.should.be.eql(body[0].datasetList[1].lastEntity);
          const dataset = body[0].datasetList[0];
          dataset.should.be.a.ExtendedDataset();
          dataset.name.should.equal('foo');

          body[0].datasetList[1].conflicts.should.equal(1);
        });
    }));

    it('should return verbs for multiple roles', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => Promise.all([
              asAlice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200),
              asAlice.post(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200),
            ]))
            .then(() => asChelsea.get('/v1/projects?forms=true')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                const { verbs } = body[0];
                verbs.should.eqlInAnyOrder([
                  // following roles from formfill + viewer:
                  'project.read',
                  // following roles from formfill only:
                  'open_form.list',
                  'open_form.read',
                  'submission.create',
                  // following roles from viewer only:
                  'form.list',
                  'form.read',
                  'submission.read',
                  'submission.list',
                  'dataset.list',
                  'dataset.read',
                  'entity.list',
                  'entity.read'
                ]);
              }))))));
  });

  it('should return the correct projects with the correct verbs', testService((service) =>
    service.login('alice', (asAlice) =>
      service.login('chelsea', (asChelsea) => Promise.all([
        asChelsea.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => body.id),
        asAlice.post('/v1/projects')
          .send({ name: 'Another Project' })
          .expect(200)
          .then(({ body }) => body.id)
      ])
        .then(([chelseaId, projectId]) => Promise.all([
          asAlice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`)
            .expect(200),
          asAlice.post(`/v1/projects/1/assignments/app-user/${chelseaId}`)
            .expect(200),
          asAlice.post(`/v1/projects/${projectId}/assignments/app-user/${chelseaId}`)
            .expect(200)
        ]))
        .then(() => asChelsea.get('/v1/projects?forms=true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            const project = body[0];
            project.id.should.equal(1);
            project.verbs.should.eqlInAnyOrder([
              // following roles from app-user + viewer:
              //none

              // following roles from app-user only:
              'open_form.read',
              'submission.create',
              // following roles from viewer only:
              'project.read',
              'form.list',
              'form.read',
              'submission.read',
              'submission.list',
              'dataset.list',
              'dataset.read',
              'entity.list',
              'entity.read'
            ]);
          }))))));
});
