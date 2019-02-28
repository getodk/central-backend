const should = require('should');
const { testService } = require('../setup');

describe('api: /assignments', () => {
  describe('GET', () => {
    it('should prohibit anonymous users from listing assignments', testService((service) =>
      service.get('/v1/assignments').expect(403)));

    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/assignments').expect(403))));

    it('should return all sitewide assignments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments')
          .expect(200)
          .then(({ body }) => Promise.all([
              asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id),
              asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
            ]).then(([ actorId, roleId ]) => {
              body.length.should.equal(1);
              body[0].should.eql({ actorId, roleId });
            })))));

    it('should return assignments in extended metadata format if requested', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
          asAlice.get('/v1/assignments').set('X-Extended-Metadata', true).expect(200).then(({ body }) => body),
          asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
      ]).then(([ assignments, adminRoleId ]) => {
        assignments.length.should.equal(1);
        Object.keys(assignments[0]).should.eql([ 'actor', 'roleId' ]);
        assignments[0].actor.displayName.should.equal('Alice');
        assignments[0].roleId.should.equal(adminRoleId);
      }))));
  });

  describe('/:roleId GET', () => {
    it('should prohibit anonymous users from listing assignments', testService((service) =>
      service.get('/v1/assignments/admin').expect(403)));

    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/assignments/admin').expect(403))));

    it('should notfound by system id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments/blahblah').expect(404))));

    it('should return all assigned actors by system id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments/admin')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.an.Actor();
            body[0].displayName.should.equal('Alice');
          }))));

    it('should notfound by numeric id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments/999').expect(404))));

    it('should return all assigned actors by numeric id', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
          asAlice.get('/v1/assignments/admin').expect(200).then(({ body }) => body),
          asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id )
        ]).then(([ actors, adminRoleId ]) => {
          actors.length.should.equal(1);
          actors[0].should.be.an.Actor();
          actors[0].displayName.should.equal('Alice');
        }))));
  });

  describe('/:roleId/:Id', () => {
    describe('POST', () => {
      it('should prohibit anonymous users from creating assignments', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((chelseaId) => service.post('/v1/assignments/admin/' + chelseaId)
              .expect(403)))));

      it('should prohibit unprivileged users from creating assignments', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((chelseaId) => asChelsea.post('/v1/assignments/admin/' + chelseaId)
              .expect(403)))));

      it('should return notfound if the role does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => service.post('/v1/assignments/99/' + aliceId)
              .expect(404)))));

      it('should return notfound if the user does not exist', testService((service) =>
        service.post('/v1/assignments/admin/999').expect(404)));

      it('should create an assignment by role system id', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((chelseaId) => service.login('alice', (asAlice) =>
              asAlice.post('/v1/assignments/admin/' + chelseaId)
                .expect(200)
                // now verify that chelsea is empowered:
                .then(() => asChelsea.get('/v1/assignments/admin')
                  .expect(200)))))));

      it('should create an assignment by role numeric id', testService((service) =>
        service.login('alice', (asAlice) => service.login('chelsea', (asChelsea) =>
          Promise.all([
            asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id),
            asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id )
          ]).then(([ chelseaId, roleId ]) =>
            asAlice.post(`/v1/assignments/${roleId}/${chelseaId}`)
              .expect(200)
              // verify a different way this time:
              .then(() => asChelsea.get('/v1/assignments/admin')
                .expect(200)
                .then(({ body }) => {
                  body.length.should.equal(2);
                  body.forEach((x) => x.should.be.an.Actor());
                  body.map((actor) => actor.displayName).should.eql([ 'Alice', 'Chelsea' ]);
                })))))));
    });

    describe('DELETE', () => {
      it('should prohibit anonymous users from creating assignments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => service.delete('/v1/assignments/admin/' + aliceId)
              .expect(403)))));

      it('should prohibit anonymous users from creating assignments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => service.login('chelsea', (asChelsea) =>
              asChelsea.delete('/v1/assignments/admin/' + aliceId).expect(403))))));

      it('should return notfound if the role does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => service.delete('/v1/assignments/99/' + aliceId)
              .expect(404)))));

      it('should return notfound if the user does not exist', testService((service) =>
        service.delete('/v1/assignments/admin/999').expect(404)));

      it('should return notfound if the assignment does not exist', testService((service) =>
        service.login('alice', (asAlice) => service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((chelseaId) => asAlice.delete('/v1/assignments/admin/' + chelseaId)
              .expect(404))))));

      it('should remove an assignment by role name', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => asAlice.delete('/v1/assignments/admin/' + aliceId)
              .expect(200)
              // again, verify the self-demotion.
              .then(() => asAlice.get('/v1/assignments').expect(403))))));

      it('should remove an assignment by role numeric id', testService((service) =>
        service.login('alice', (asAlice) => Promise.all([
          asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id ),
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
        ])
          .then(([ roleId, aliceId ]) => asAlice.delete(`/v1/assignments/${roleId}/${aliceId}`)
              .expect(200)
              // again, verify the self-demotion.
              .then(() => asAlice.get('/v1/assignments').expect(403))))));
    });
  });
});

////////////////////////////////////////////////////////////////////////////////
// PROJECTS ASSIGNMENTS TESTS
// since the resource code is mixed in with assignments.js, so too are the tests.

describe('/projects/:id/assignments', () => {
  describe('GET', () => {
    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/assignments').expect(403))));

    it('should return notfound if the project does not exist', testService((service) =>
      service.get('/v1/projects/99/assignments').expect(404)));

    it('should list all assignments', testService((service) =>
      service.login('bob', (asBob) => Promise.all([
        asBob.get('/v1/roles/manager').expect(200).then(({ body }) => body.id ),
        asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
      ])
        .then(([ roleId, bobId ]) => asBob.get('/v1/projects/1/assignments')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.eql({ roleId, actorId: bobId });
          })))));
  });

  describe('/:roleId GET', () => {
    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/assignments/manager').expect(403))));

    it('should return notfound if the project does not exist', testService((service) =>
      service.get('/v1/projects/99/assignments/manager').expect(404)));

    it('should list all assignees by role system name', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/projects/1/assignments/manager')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.an.Actor();
            body[0].displayName.should.equal('Bob');
          }))));

    it('should list all assignees by role numeric id', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/roles/manager').expect(200).then(({ body }) => body.id)
          .then((roleId) => asBob.get('/v1/projects/1/assignments/' + roleId)
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.an.Actor();
              body[0].displayName.should.equal('Bob');
            })))));
  });

  describe('/:roleId/:actorId POST', () => {
    it('should prohibit unprivileged users from creating assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((chelseaId) => asChelsea.post('/v1/projects/1/assignments/manager/' + chelseaId)
            .expect(403)))));

    it('should return notfound if the project does not exist', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((chelseaId) => asChelsea.post('/v1/projects/99/assignments/manager/' + chelseaId)
            .expect(404)))));

    it('should return notfound if the role does not exist', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((chelseaId) => asChelsea.post('/v1/projects/1/assignments/99/' + chelseaId)
            .expect(404)))));

    it('should return notfound if the user does not exist', testService((service) =>
      service.post('/v1/projects/1/assignments/manager/999')
        .expect(404)));

    it('should assign the actor by role system name', testService((service) =>
      service.login('bob', (asBob) => service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((chelseaId) => asBob.post('/v1/projects/1/assignments/manager/' + chelseaId)
            .expect(200)
            // verify:
            .then(() => asChelsea.get('/v1/projects/1').expect(200)))))));

    it('should assign the actor by role numeric id', testService((service) =>
      service.login('bob', (asBob) => service.login('chelsea', (asChelsea) =>
        Promise.all([
          service.get('/v1/roles/manager').expect(200).then(({ body }) => body.id),
          asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
        ])
          .then(([ roleId, chelseaId ]) => asBob.post(`/v1/projects/1/assignments/${roleId}/${chelseaId}`)
            .expect(200)
            // verify a different way:
            .then(() => asChelsea.get('/v1/projects/1/assignments/manager')
              .expect(200)
              .then(({ body }) => {
                body.length.should.equal(2);
                body.forEach((x) => x.should.be.an.Actor());
                body.map((actor) => actor.displayName).should.eql([ 'Bob', 'Chelsea' ]);
              })))))));
  });

  describe('/:roleId/:actorId DELETE', () => {
    it('should prohibit unprivileged users from deleting assignments', testService((service) =>
      service.login('bob', (asBob) => service.login('chelsea', (asChelsea) =>
        asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((bobId) => asChelsea.delete('/v1/projects/1/assignments/manager/' + bobId)
            .expect(403))))));

    it('should return notfound if the project does not exist', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((bobId) => service.delete('/v1/projects/99/assignments/manager/' + bobId)
            .expect(404)))));

    it('should return notfound if the role does not exist', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((bobId) => service.delete('/v1/projects/1/assignments/99/' + bobId)
            .expect(404)))));

    it('should return notfound if the user does not exist', testService((service) =>
      service.delete('/v1/projects/1/assignments/manager/999')
        .expect(404)));

    it('should unassign the actor by role system name', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((bobId) => asBob.delete('/v1/projects/1/assignments/manager/' + bobId)
            .expect(200)
            // verify:
            .then(() => asBob.get('/v1/projects/1').expect(403))))));

    it('should assign the actor by role numeric id', testService((service) =>
      service.login('bob', (asBob) =>
        Promise.all([
          service.get('/v1/roles/manager').expect(200).then(({ body }) => body.id),
          asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
        ])
          .then(([ roleId, bobId ]) => asBob.delete(`/v1/projects/1/assignments/${roleId}/${bobId}`)
            .expect(200)
            // verify a different way:
            .then(() => service.login('alice', (asAlice) =>
              asAlice.get('/v1/projects/1/assignments/manager')
                .expect(200)
                .then(({ body }) => { body.length.should.equal(0); })))))));
  });
});

