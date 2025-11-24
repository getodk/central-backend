const appRoot = require('app-root-path');
const should = require('should');
const uuid = require('uuid').v4;
const { sql } = require('slonik');
const { plain } = require('../../util/util');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { exhaust } = require(appRoot + '/lib/worker/worker');
const { Form } = require(appRoot + '/lib/model/frames');

const assertAuditActions = (audits, expected) => {
  audits.map(a => a.action).should.deepEqual(expected);
};
const submitThree = (asAlice) =>
  asAlice.post('/v1/projects/1/forms/simple/submissions')
    .send(testData.instances.simple.one)
    .set('Content-Type', 'text/xml')
    .expect(200)
    .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.two)
      .set('Content-Type', 'text/xml')
      .expect(200))
    .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.three)
      .set('Content-Type', 'text/xml')
      .expect(200));

describe('/audits', () => {
  describe('GET', () => {
    it('should reject if the user cannot read audits', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/audits').expect(403))));

    it('should return all activity', testService((service, { Projects, Users }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectId) => asAlice.patch(`/v1/projects/${projectId}`)
            .send({ name: 'renamed audit project' })
            .expect(200)
            .then(() => asAlice.post('/v1/users')
              .send({ displayName: 'david', email: 'david@getodk.org' })
              .expect(200))
            .then(() => Promise.all([
              asAlice.get('/v1/audits').expect(200).then(({ body }) => body),
              Projects.getById(projectId).then((o) => o.get()),
              Users.getByEmail('alice@getodk.org').then((o) => o.get()),
              Users.getByEmail('david@getodk.org').then((o) => o.get())
            ]))
            .then(([ audits, project, alice, david ]) => {
              assertAuditActions(audits, [
                'user.create',
                'project.update',
                'project.create',
                'user.session.create',
              ]);
              audits.forEach((audit) => { audit.should.be.an.Audit(); });

              audits[0].actorId.should.equal(alice.actor.id);
              audits[0].action.should.equal('user.create');
              audits[0].acteeId.should.equal(david.actor.acteeId);
              audits[0].details.should.eql({ data: {
                actorId: david.actor.id,
                email: 'david@getodk.org',
                password: null,
                lastLoginAt: null
              } });
              audits[0].loggedAt.should.be.a.recentIsoDate();

              audits[1].actorId.should.equal(alice.actor.id);
              audits[1].action.should.equal('project.update');
              audits[1].acteeId.should.equal(project.acteeId);
              audits[1].details.should.eql({ data: { name: 'renamed audit project' } });
              audits[1].loggedAt.should.be.a.recentIsoDate();

              audits[2].actorId.should.equal(alice.actor.id);
              audits[2].action.should.equal('project.create');
              audits[2].acteeId.should.equal(project.acteeId);
              audits[2].details.should.eql({ data: { name: 'audit project' } });
              audits[2].loggedAt.should.be.a.recentIsoDate();

              audits[3].actorId.should.equal(alice.actor.id);
              audits[3].action.should.equal('user.session.create');
              audits[3].acteeId.should.equal(alice.actor.acteeId);
              audits[3].loggedAt.should.be.a.recentIsoDate();
            })))));

    it('should return extended data if requested', testService((service, { Projects, Forms, Users }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectId) => asAlice.post(`/v1/projects/${projectId}/forms?publish=true`)
            .send(testData.forms.simple)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/users')
              .send({ displayName: 'david', email: 'david@getodk.org' })
              .expect(200))
            .then(() => Promise.all([
              asAlice.get('/v1/audits').set('X-Extended-Metadata', true)
                .expect(200).then(({ body }) => body),
              Projects.getById(projectId).then((o) => o.get())
                .then((project) => Forms.getByProjectAndXmlFormId(project.id, 'simple', Form.PublishedVersion)
                  .then((o) => o.get())
                  .then((form) => [ project, form ])),
              Users.getByEmail('alice@getodk.org').then((o) => o.get()),
              Users.getByEmail('david@getodk.org').then((o) => o.get())
            ]))
            .then(([ audits, [ project, form ], alice, david ]) => {
              assertAuditActions(audits, [
                'user.create',
                'form.update.publish',
                'form.create',
                'project.create',
                'user.session.create',
              ]);
              audits.forEach((audit) => { audit.should.be.an.Audit(); });

              audits[0].actorId.should.equal(alice.actor.id);
              audits[0].actor.should.eql(plain(alice.actor.forApi()));
              audits[0].action.should.equal('user.create');
              audits[0].acteeId.should.equal(david.actor.acteeId);
              audits[0].actee.should.eql(plain(david.actor.forApi()));
              audits[0].details.should.eql({ data: {
                actorId: david.actor.id,
                email: 'david@getodk.org',
                password: null,
                lastLoginAt: null
              } });
              audits[0].loggedAt.should.be.a.recentIsoDate();

              audits[1].actorId.should.equal(alice.actor.id);
              audits[1].actor.should.eql(plain(alice.actor.forApi()));
              audits[1].action.should.equal('form.update.publish');
              audits[1].acteeId.should.equal(form.acteeId);
              audits[1].actee.should.eql(plain(form.forApi()));
              audits[1].details.should.eql({ newDefId: form.currentDefId, oldDefId: null });
              audits[1].loggedAt.should.be.a.recentIsoDate();

              audits[2].actorId.should.equal(alice.actor.id);
              audits[2].actor.should.eql(plain(alice.actor.forApi()));
              audits[2].action.should.equal('form.create');
              audits[2].acteeId.should.equal(form.acteeId);
              audits[2].actee.should.eql(plain(form.forApi()));
              should.not.exist(audits[2].details);
              audits[2].loggedAt.should.be.a.recentIsoDate();

              audits[3].actorId.should.equal(alice.actor.id);
              audits[3].actor.should.eql(plain(alice.actor.forApi()));
              audits[3].action.should.equal('project.create');
              audits[3].acteeId.should.equal(project.acteeId);
              audits[3].actee.should.eql(plain(project.forApi()));
              audits[3].details.should.eql({ data: { name: 'audit project' } });
              audits[3].loggedAt.should.be.a.recentIsoDate();

              audits[4].actorId.should.equal(alice.actor.id);
              audits[4].actor.should.eql(plain(alice.actor.forApi()));
              audits[4].action.should.equal('user.session.create');
              audits[4].acteeId.should.equal(alice.actor.acteeId);
              audits[4].actee.should.eql(plain(alice.actor.forApi()));
              audits[4].loggedAt.should.be.a.recentIsoDate();
            })))));

    it('should return Enketo IDs for form', testService(async (service) => {
      const asAlice = await service.login('alice');
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simple2)
        .set('Content-Type', 'application/xml')
        .expect(200);
      const { body: audits } = await asAlice.get('/v1/audits')
        .set('X-Extended-Metadata', true)
        .expect(200);
      assertAuditActions(audits, [
        'form.update.publish',
        'form.create',
        'user.session.create'
      ]);
      const form = audits[0].actee;
      form.enketoId.should.equal('::abcdefgh');
      form.enketoOnceId.should.equal('::::abcdefgh');
    }));

    it('should not expand actor if there is no actor', testService((service, { run }) =>
      run(sql`insert into audits (action, "loggedAt") values ('analytics', now())`)
        .then(() => service.login('alice', (asAlice) =>
          asAlice.get('/v1/audits?action=analytics')
            .set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              should.not.exist(body[0].actor);
            })))));

    it('should page data', testService((service) =>
      service.login('alice', (asAlice) =>
        submitThree(asAlice)
          .then(() => asAlice.get('/v1/audits?offset=1&limit=1')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].details.instanceId.should.equal('two');
            })))));

    it('should page extended data', testService((service) =>
      service.login('alice', (asAlice) =>
        submitThree(asAlice)
          .then(() => asAlice.get('/v1/audits?offset=1&limit=1')
            .set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].actor.displayName.should.equal('Alice');
              body[0].details.instanceId.should.equal('two');
              body[0].actee.xmlFormId.should.equal('simple');
            })))));

    it('should filter by action', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectId) => asAlice.post(`/v1/projects/${projectId}/forms`)
            .send(testData.forms.simple)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/users')
              .send({ displayName: 'david', email: 'david@getodk.org' })
              .expect(200))
            .then(() => asAlice.get('/v1/audits?action=form.create')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].action.should.equal('form.create');
              }))))));

    // we don't test every single action. but we do exercise every category.
    it('should filter by action category (user)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(() => asAlice.post('/v1/users')
            .send({ displayName: 'david', email: 'david@getodk.org' })
            .expect(200)
            .then(({ body }) => body.id)
            .then((davidId) => asAlice.patch(`/v1/users/${davidId}`)
              .send({ displayName: 'David' })
              .expect(200)
              .then(() => asAlice.post(`/v1/assignments/admin/${davidId}`)
                .expect(200))
              .then(() => asAlice.delete(`/v1/assignments/admin/${davidId}`)
                .expect(200))
              .then(() => asAlice.delete(`/v1/users/${davidId}`)
                .expect(200))))
          .then(() => asAlice.get('/v1/audits?action=user')
            .expect(200)
            .then(({ body }) => {
              assertAuditActions(body, [
                'user.delete',
                'user.assignment.delete',
                'user.assignment.create',
                'user.update',
                'user.create',
                'user.session.create',
              ]);
            })))));

    it('should filter by action category (project)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectId) => asAlice.patch(`/v1/projects/${projectId}`)
            .send({ name: 'Audit Project' })
            .expect(200)
            .then(() => asAlice.delete(`/v1/projects/${projectId}`)
              .expect(200)))
          .then(() => asAlice.post('/v1/users')
            .send({ displayName: 'david', email: 'david@getodk.org' })
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=project')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body[0].action.should.equal('project.delete');
              body[1].action.should.equal('project.update');
              body[2].action.should.equal('project.create');
            })))));

    it('should filter by action category (form)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectId) => asAlice.post(`/v1/projects/${projectId}/forms`)
            .send(testData.forms.simple)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.patch(`/v1/projects/${projectId}/forms/simple`)
              .send({ state: 'closing' })
              .expect(200))
            .then(() => asAlice.delete(`/v1/projects/${projectId}/forms/simple`)
              .expect(200)))
          .then(() => asAlice.post('/v1/users')
            .send({ displayName: 'david', email: 'david@getodk.org' })
            .expect(200))
          .then(() => asAlice.get('/v1/audits?action=form')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body[0].action.should.equal('form.delete');
              body[1].action.should.equal('form.update');
              body[2].action.should.equal('form.create');
            })))));

    it('should filter by action category (submission)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectId) => asAlice.post(`/v1/projects/${projectId}/forms?publish=true`)
            .send(testData.forms.simple)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post(`/v1/projects/${projectId}/forms/simple/submissions`)
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200)))
          .then(() => asAlice.get('/v1/audits?action=submission')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].action.should.equal('submission.create');
            })))));

    it('should filter by action category (dataset)', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.get('/v1/audits?action=dataset')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
          body.map(a => a.action).should.eql([
            'dataset.create'
          ]);
        });
    }));

    it('should filter by action category (entity)', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);
      // this second sub will make an error when processing
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.two
          .replace('uuid:12345678-1234-4123-8234-123456789aaa', '12345678-1234-4123-8234-123456789abc'))
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
        .send({ reviewState: 'approved' })
        .expect(200);
      await exhaust(container);
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({
          data: { age: '77', first_name: 'Alan' }
        })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // all properties changed
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?resolve=true&baseVersion=3')
        .expect(200);

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });

      await asAlice.post('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/restore')
        .expect(200);
      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);
      await container.Entities.purge(true);

      await asAlice.get('/v1/audits?action=entity')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(9);
          body.map(a => a.action).should.eql([
            'entity.purge',
            'entity.delete',
            'entity.restore',
            'entity.delete',
            'entity.update.resolve',
            'entity.update.version',
            'entity.update.version',
            'entity.error',
            'entity.create'
          ]);
        });
    }));

    it('should filter extended data by action', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'audit project' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectId) => asAlice.post(`/v1/projects/${projectId}/forms`)
            .send(testData.forms.simple)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/users')
              .send({ displayName: 'david', email: 'david@getodk.org' })
              .expect(200))
            .then(() => asAlice.get('/v1/audits?action=form.create')
              .set('X-Extended-Metadata', true)
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(1);
                body[0].action.should.equal('form.create');
                body[0].actor.displayName.should.equal('Alice');
                body[0].actee.xmlFormId.should.equal('simple');
              }))))));

    it('should filter (inclusively) by start date', testService((service, { run }) =>
      Promise.all(
        [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
          .map((day) => run(sql`insert into audits ("loggedAt", action) values (${`2000-01-${day}T00:00Z`}, ${`test.${day}`})`))
      )
        .then(() => service.login('alice', (asAlice) =>
          asAlice.get('/v1/audits?start=2000-01-08Z')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(4);

              body[0].action.should.equal('user.session.create');
              body[1].action.should.equal('test.10');
              body[1].loggedAt.should.equal('2000-01-10T00:00:00.000Z');
              body[2].action.should.equal('test.9');
              body[2].loggedAt.should.equal('2000-01-09T00:00:00.000Z');
              body[3].action.should.equal('test.8');
              body[3].loggedAt.should.equal('2000-01-08T00:00:00.000Z');
            })))));

    it('should filter by start date+time', testService((service, { run }) =>
      Promise.all(
        [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
          .map((day) => run(sql`insert into audits ("loggedAt", action) values (${`2000-01-${day}T00:00Z`}, ${`test.${day}`})`))
      )
        .then(() => service.login('alice', (asAlice) =>
          asAlice.get('/v1/audits?start=2000-01-08T12:00Z')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);

              body[0].action.should.equal('user.session.create');
              body[1].action.should.equal('test.10');
              body[1].loggedAt.should.equal('2000-01-10T00:00:00.000Z');
              body[2].action.should.equal('test.9');
              body[2].loggedAt.should.equal('2000-01-09T00:00:00.000Z');
            })))));

    it('should filter extended data by start date+time', testService((service, { Users, run }) =>
      Users.getByEmail('alice@getodk.org').then((o) => o.get())
        .then((alice) => Promise.all(
          [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
            .map((day) => run(sql`insert into audits ("loggedAt", action, "actorId", "acteeId") values (${`2000-01-${day}T00:00Z`}, ${`test.${day}`}, ${alice.actor.id}, ${alice.actor.acteeId})`))
        )
          .then(() => service.login('alice', (asAlice) =>
            asAlice.get('/v1/audits?start=2000-01-08T12:00Z')
              .set('X-Extended-Metadata', true)
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(3);

                body[0].action.should.equal('user.session.create');
                body[1].action.should.equal('test.10');
                body[1].loggedAt.should.equal('2000-01-10T00:00:00.000Z');
                body[1].actor.displayName.should.equal('Alice');
                body[1].actee.displayName.should.equal('Alice');
                body[2].action.should.equal('test.9');
                body[2].loggedAt.should.equal('2000-01-09T00:00:00.000Z');
                body[2].actor.displayName.should.equal('Alice');
                body[2].actee.displayName.should.equal('Alice');
              }))))));

    it('should filter (inclusively) by end date', testService((service, { run }) =>
      Promise.all(
        [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
          .map((day) => run(sql`insert into audits ("loggedAt", action) values (${`2000-01-${day}T00:00Z`}, ${`test.${day}`})`))
      )
        .then(() => service.login('alice', (asAlice) =>
          asAlice.get('/v1/audits?end=2000-01-03Z')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);

              body[0].action.should.equal('test.3');
              body[0].loggedAt.should.equal('2000-01-03T00:00:00.000Z');
              body[1].action.should.equal('test.2');
              body[1].loggedAt.should.equal('2000-01-02T00:00:00.000Z');
              body[2].action.should.equal('test.1');
              body[2].loggedAt.should.equal('2000-01-01T00:00:00.000Z');
            })))));

    it('should filter by end date+time', testService((service, { run }) =>
      Promise.all(
        [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
          .map((day) => run(sql`insert into audits ("loggedAt", action) values (${`2000-01-${day}T00:00Z`}, ${`test.${day}`})`))
      )
        .then(() => service.login('alice', (asAlice) =>
          asAlice.get('/v1/audits?end=2000-01-02T12:00Z')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);

              body[0].action.should.equal('test.2');
              body[0].loggedAt.should.equal('2000-01-02T00:00:00.000Z');
              body[1].action.should.equal('test.1');
              body[1].loggedAt.should.equal('2000-01-01T00:00:00.000Z');
            })))));

    it('should filter extended data by end date+time', testService((service, { Users, run }) =>
      Users.getByEmail('alice@getodk.org').then((o) => o.get())
        .then((alice) => Promise.all(
          [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
            .map((day) => run(sql`insert into audits ("loggedAt", action, "actorId", "acteeId") values (${`2000-01-${day}T00:00Z`}, ${`test.${day}`}, ${alice.actor.id}, ${alice.actor.acteeId})`))
        )
          .then(() => service.login('alice', (asAlice) =>
            asAlice.get('/v1/audits?end=2000-01-02T12:00Z')
              .set('X-Extended-Metadata', true)
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(2);

                body[0].action.should.equal('test.2');
                body[0].loggedAt.should.equal('2000-01-02T00:00:00.000Z');
                body[0].actor.displayName.should.equal('Alice');
                body[0].actee.displayName.should.equal('Alice');
                body[1].action.should.equal('test.1');
                body[1].loggedAt.should.equal('2000-01-01T00:00:00.000Z');
                body[1].actor.displayName.should.equal('Alice');
                body[1].actee.displayName.should.equal('Alice');
              }))))));

    it('should filter out submission and backup events given action=nonverbose', testService((service, { run }) =>
      service.login('alice', (asAlice) =>
        Promise.all([
          run(sql`insert into audits (action, "loggedAt", details) values ('backup', now(), '{"success":true}')`),
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.binaryType)
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .expect(201)
              .then(() => asAlice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
                .send('attachment')
                .expect(200)))
        ])
          .then(() => asAlice.get('/v1/audits?action=nonverbose')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body[0].action.should.equal('form.update.publish');
              body[1].action.should.equal('form.create');
              body[2].action.should.equal('user.session.create');
            })))));

    it('should filter out entity events given action=nonverbose', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);
      await exhaust(container);
      await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({
          data: { age: '77', first_name: 'Alan' }
        })
        .expect(200);
      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body }) => {
          body.success.should.be.true();
        });
      await asAlice.post('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/restore')
        .expect(200);
      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);
      await container.Entities.purge(true);
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          source: {
            name: 'people.csv',
            size: 100,
          },
          entities: [
            {
              label: 'Johnny Doe',
              data: {
                first_name: 'Johnny',
                age: '22'
              }
            }
          ]
        })
        .expect(200);

      await asAlice.get('/v1/audits?action=nonverbose')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(4);
          body.map(a => a.action).should.eql([
            'form.update.publish',
            'dataset.create',
            'form.create',
            'user.session.create'
          ]);
        });
    }));

    it('should filter out offline entity submission backlog events given action=nonverbose', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.offlineEntity)
        .expect(200);

      const branchId = uuid();

      // second submission in a branch will get held to wait for first in branch
      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('create="1"', 'update="1"')
          .replace('branchId=""', `branchId="${branchId}"`)
          .replace('two', 'two-update')
          .replace('baseVersion=""', 'baseVersion="1"')
          .replace('<status>new</status>', '<status>checked in</status>')
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/offlineEntity/submissions')
        .send(testData.instances.offlineEntity.two
          .replace('branchId=""', `branchId="${branchId}"`)
        )
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/audits?action=nonverbose')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(4);
          body.map(a => a.action).should.eql([
            'form.update.publish',
            'dataset.create',
            'form.create',
            'user.session.create'
          ]);
        });
    }));

    it('should log and return notes if given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .set('X-Action-Notes', 'doing this for fun%21')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .set('X-Action-Notes', 'doing this for work')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.get('/v1/audits')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(4);
              body[0].action.should.equal('submission.create');
              body[0].notes.should.equal('doing this for work');
              body[1].action.should.equal('form.update.publish');
              body[1].notes.should.equal('doing this for fun!');
              body[2].action.should.equal('form.create');
              body[2].notes.should.equal('doing this for fun!');
              body[3].action.should.equal('user.session.create');
            })))));

    it('should fail gracefully if note decoding fails', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .set('X-Action-Notes', 'doing this for fun%ae')
          .send(testData.forms.binaryType)
          .expect(400)
          .then(({ body }) => {
            body.should.deepEqual({
              code: 400.6,
              details: { field: 'x-action-notes' },
              message: 'An expected header field (x-action-notes) did not match the expected format.',
            });
          }))));

    describe('audit logs of deleted and purged actees', () => {
      it('should get the information of a purged actee', testService(async (service, { Forms }) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/projects/1/forms/simple')
            .then(() => Forms.purge(true))
            .then(() => asAlice.get('/v1/audits').set('X-Extended-Metadata', true)
              .expect(200))
            .then(({ body }) => {
              const purgedActee = body[0].actee;
              purgedActee.purgedName.should.equal('Simple');
              purgedActee.purgedAt.should.be.a.recentIsoDate();
              purgedActee.details.formId.should.equal(1);
              purgedActee.details.projectId.should.equal(1);
              purgedActee.details.version.should.equal('');
              purgedActee.details.xmlFormId.should.equal('simple');
            }))));

      it('should get the deletedAt date of a deleted form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/projects/1/forms/simple')
            .then(() => asAlice.get('/v1/audits').set('X-Extended-Metadata', true))
            .then(({ body }) => {
              const deletedActee = body[0].actee; // actee of most recent audit, which is a form
              deletedActee.name.should.equal('Simple');
              deletedActee.deletedAt.should.be.a.recentIsoDate();
            }))));

      it('should get the deletedAt date of a deleted user', testService((service, { Users }) =>
        service.login('alice', (asAlice) =>
          Users.getByEmail('chelsea@getodk.org').then((o) => o.get())
            .then((chelsea) => asAlice.delete('/v1/users/' + chelsea.actorId)
              .expect(200))
            .then(() => asAlice.get('/v1/audits').set('X-Extended-Metadata', true))
            .then(({ body }) => {
              const deletedActee = body[0].actee;
              deletedActee.displayName.should.equal('Chelsea');
              deletedActee.deletedAt.should.be.a.recentIsoDate();
            }))));

      it('should get the deletedAt date of a deleted project', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/projects/1')
            .expect(200)
            .then(() => asAlice.get('/v1/audits').set('X-Extended-Metadata', true))
            .then(({ body }) => {
              const deletedActee = body[0].actee;
              deletedActee.name.should.equal('Default Project');
              deletedActee.deletedAt.should.be.a.recentIsoDate();
            }))));

      it('should get the deletedAt date of a deleted app user', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/app-users')
            .send({ displayName: 'App User Name' })
            .then(({ body }) => body)
            .then((appUser) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${appUser.id}`)
              .then(() => asAlice.delete('/v1/projects/1/app-users/' + appUser.id)))
            .then(() => asAlice.get('/v1/audits').set('X-Extended-Metadata', true))
            .then(({ body }) => {
              const deletedActee = body[0].actee;
              deletedActee.displayName.should.equal('App User Name');
              deletedActee.deletedAt.should.be.a.recentIsoDate();
            }))));

      it('should get the deletedAt date of a deleted public link', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/public-links')
            .send({ displayName: 'Public Link Name' })
            .then(({ body }) => body)
            .then((link) => asAlice.delete('/v1/projects/1/forms/simple/public-links/' + link.id))
            .then(() => asAlice.get('/v1/audits').set('X-Extended-Metadata', true))
            .then(({ body }) => {
              const deletedActee = body[0].actee;
              deletedActee.displayName.should.equal('Public Link Name');
              deletedActee.deletedAt.should.be.a.recentIsoDate();
            }))));
    });

    describe('audit logs of dataset and entity events', () => {
      it('should get the actee information of a dataset', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/audits?action=dataset').set('X-Extended-Metadata', true)
              .expect(200))
            .then(({ body }) => {
              const datasetActee = body[0].actee;
              datasetActee.name.should.equal('people');
              datasetActee.projectId.should.equal(1);
            }))));

      it('should get the actee information of a dataset through an entity event', testService(async (service, container) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one)
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
              .send({ reviewState: 'approved' })
              .expect(200)));

        await exhaust(container);

        await service.login('alice', (asAlice) =>
          asAlice.get('/v1/audits?action=entity').set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              const datasetActee = body[0].actee;
              datasetActee.name.should.equal('people');
              datasetActee.projectId.should.equal(1);
            }));
      }));
    });

    describe('audit logs of OpenRosa submission attachment events', () => {
      it('should get the attachment events of a (partial) submission', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .set('Content-Type', 'application/xml')
            .send(testData.forms.binaryType)
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
              .expect(201)
              .then(() => asAlice.get('/v1/audits?action=submission.attachment.update')
                .expect(200))
              .then(({ body }) => {
                body[0].details.name.should.equal('my_file1.mp4');
              })
            )
            .then(() => asAlice.post('/v1/projects/1/submission')
              .set('X-OpenRosa-Version', '1.0')
              .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
              .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
              .expect(201)
              .then(() => asAlice.get('/v1/audits?action=submission.attachment.update')
                .expect(200))
              .then(({ body }) => {
                body.length.should.equal(2);
                body[0].details.name.should.equal('here_is_file2.jpg');
                body[1].details.name.should.equal('my_file1.mp4');
              })
            )
        )
      ));
    });

  });
});
