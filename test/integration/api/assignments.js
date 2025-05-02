const { testService } = require('../setup');

describe('api: /projects/:id/assignments/forms', () => {
  // helper that does a bunch of assignments that we will use to test these apis:
  // * make chelsea a manager on simple form
  // * create app user david and assign app user on simple form
  // * create app user eleanor and assign app user on withrepeat form
  // then, it GETs the given path with the given extended flag and returns that
  // result.
  const doAssigns = (service, path, extended) =>
    service.login('alice', (asAlice) => Promise.all([
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => body)
          .then((chelsea) => asAlice.post(`/v1/projects/1/forms/simple/assignments/manager/${chelsea.id}`)
            .expect(200)
            .then(() => chelsea))),
      asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'david' })
        .expect(200)
        .then(({ body }) => body)
        .then((david) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${david.id}`)
          .expect(200)
          .then(() => david)),
      asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'eleanor' })
        .expect(200)
        .then(({ body }) => body)
        .then((eleanor) => asAlice.post(`/v1/projects/1/forms/withrepeat/assignments/app-user/${eleanor.id}`)
          .expect(200)
          .then(() => eleanor))
    ])
      .then(([ chelsea, david, eleanor ]) => Promise.all([
        asAlice.get(path)
          .set('X-Extended-Metadata', extended)
          .expect(200)
          .then(({ body }) => body),
        asAlice.get('/v1/roles/app-user').expect(200).then(({ body }) => body.id),
        asAlice.get('/v1/roles/manager').expect(200).then(({ body }) => body.id)
      ])
        .then(([ result, appUserRoleId, managerRoleId ]) =>
          ({ chelsea, david, eleanor, appUserRoleId, managerRoleId, result }))));

  // helper that verifies that some particular assignment exists as expected.
  const verify = (result, actorId, xmlFormId, roleId) => {
    result.some((assignment) => (assignment.actorId === actorId) && (assignment.xmlFormId === xmlFormId) &&
      // eslint-disable-next-line eqeqeq
      (assignment.roleId == roleId)).should.equal(true);
  };
  const verifyExtended = (result, actorId, xmlFormId, roleId) => {
    result.some((assignment) => (assignment.actor.id === actorId) && (assignment.xmlFormId === xmlFormId) &&
      // eslint-disable-next-line eqeqeq
      (assignment.roleId == roleId)).should.equal(true);
  };

  describe('GET', () => {
    it('should reject if the project does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/2/assignments/forms')
          .expect(404))));

    it('should reject if the user cannot list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/assignments/forms')
          .expect(403))));

    it('should return all assignments on forms', testService((service) =>
      doAssigns(service, '/v1/projects/1/assignments/forms', '')
        .then(({ chelsea, david, eleanor, appUserRoleId, managerRoleId, result }) => {
          result.length.should.equal(3);

          verify(result, chelsea.id, 'simple', managerRoleId);
          verify(result, david.id, 'simple', appUserRoleId);
          verify(result, eleanor.id, 'withrepeat', appUserRoleId);
        })));

    it('should return extended assignments on forms', testService((service) =>
      doAssigns(service, '/v1/projects/1/assignments/forms', true)
        .then(({ chelsea, david, eleanor, appUserRoleId, managerRoleId, result }) => {
          result.length.should.equal(3);

          for (const assignment of result) assignment.actor.should.be.an.Actor();

          verifyExtended(result, chelsea.id, 'simple', managerRoleId);
          verifyExtended(result, david.id, 'simple', appUserRoleId);
          verifyExtended(result, eleanor.id, 'withrepeat', appUserRoleId);
        })));
  });

  describe('/:roleId GET', () => {
    it('should reject if the project does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/2/assignments/forms/app-user')
          .expect(404))));

    it('should reject if the user cannot list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/assignments/forms/app-user')
          .expect(403))));

    it('should return filtered assignments on forms', testService((service) =>
      doAssigns(service, '/v1/projects/1/assignments/forms/app-user', '')
        .then(({ david, eleanor, appUserRoleId, result }) => {
          result.length.should.equal(2);

          verify(result, david.id, 'simple', appUserRoleId);
          verify(result, eleanor.id, 'withrepeat', appUserRoleId);
        })));

    it('should return filtered extended assignments on forms', testService((service) =>
      doAssigns(service, '/v1/projects/1/assignments/forms/app-user', true)
        .then(({ david, eleanor, appUserRoleId, result }) => {
          result.length.should.equal(2);

          for (const assignment of result) assignment.actor.should.be.an.Actor();

          verifyExtended(result, david.id, 'simple', appUserRoleId);
          verifyExtended(result, eleanor.id, 'withrepeat', appUserRoleId);
        })));
  });
});

// because we use the same code to generically define most of our assignments APIs,
// we follow a three-tier testing strategy here:
// 1. fully test all the functionality on the root API since it is sort of a strange case
// 2. fully test all the functionality on the Projects assignments API to be sure
//    the individual instance case works as expected
// 3. cursorily test each of the other resource-specific APIs to be sure they're
//    plumbed in correctly

describe('api: /assignments', () => {
  describe('GET', () => {
    it('should prohibit anonymous users from listing assignments', testService((service) =>
      service.get('/v1/assignments').expect(401)));

    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/assignments').expect(403))));

    it('should return all sitewide assignments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments')
          .expect(200)
          .then(({ body }) => Promise.all([
            // eslint-disable-next-line no-shadow
            asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id),
            // eslint-disable-next-line no-shadow
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
        Object.keys(assignments[0]).should.eql([ 'actorId', 'roleId', 'actor' ]);
        assignments[0].actor.should.be.an.Actor();
        assignments[0].actor.displayName.should.equal('Alice');
        assignments[0].roleId.should.equal(adminRoleId);
      }))));
  });

  describe('/:roleId GET', () => {
    it('should prohibit anonymous users from listing assignments', testService((service) =>
      service.get('/v1/assignments/admin').expect(401)));

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
      service.login('alice', (asAlice) =>
        // eslint-disable-next-line space-in-parens
        asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id )
          .then((adminRoleId) => asAlice.get('/v1/assignments/' + adminRoleId)
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.an.Actor();
              body[0].displayName.should.equal('Alice');
            })))));
  });

  describe('/:roleId/:actorId', () => {
    describe('POST', () => {
      it('should prohibit anonymous users from creating assignments', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((chelseaId) => service.post('/v1/assignments/admin/' + chelseaId)
              .expect(401)))));

      it('should prohibit unprivileged users from creating assignments', testService((service) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((chelseaId) => asChelsea.post('/v1/assignments/admin/' + chelseaId)
              .expect(403)))));

      it('should return notfound if the role does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => asAlice.post('/v1/assignments/99/' + aliceId)
              .expect(404)))));

      it('should return notfound if the user does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/assignments/admin/999').expect(404))));

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
            asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
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

      it('should log the action in the audit log', testService((service, { Audits, Users }) =>
        Users.getByEmail('chelsea@getodk.org')
          .then((maybeChelsea) => maybeChelsea.get())
          .then((chelsea) => service.login('alice', (asAlice) =>
            asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
              .then((adminRoleId) => asAlice.post(`/v1/assignments/${adminRoleId}/${chelsea.actor.id}`)
                .expect(200)
                .then(() => Promise.all([
                  Users.getByEmail('alice@getodk.org').then((maybeAlice) => maybeAlice.get()),
                  Audits.getLatestByAction('user.assignment.create')
                ]))
                .then(([ alice, audit ]) => {
                  audit.isDefined().should.equal(true);
                  audit.get().actorId.should.equal(alice.actor.id);
                  audit.get().acteeId.should.equal(chelsea.actor.acteeId);
                  audit.get().details.should.eql({ roleId: adminRoleId, grantedActeeId: '*' });
                }))))));
    });

    describe('DELETE', () => {
      it('should prohibit anonymous users from creating assignments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => service.delete('/v1/assignments/admin/' + aliceId)
              .expect(401)))));

      it('should prohibit unprivileged users from creating assignments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => service.login('chelsea', (asChelsea) =>
              asChelsea.delete('/v1/assignments/admin/' + aliceId).expect(403))))));

      it('should return notfound if the role does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((aliceId) => asAlice.delete('/v1/assignments/99/' + aliceId)
              .expect(404)))));

      it('should return notfound if the user does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.delete('/v1/assignments/admin/999').expect(404))));

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
          // eslint-disable-next-line space-in-parens
          asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id ),
          asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id)
        ])
          .then(([ roleId, aliceId ]) => asAlice.delete(`/v1/assignments/${roleId}/${aliceId}`)
            .expect(200)
          // again, verify the self-demotion.
            .then(() => asAlice.get('/v1/assignments').expect(403))))));

      it('should log the action in the audit log', testService((service, { Audits, Users }) =>
        Users.getByEmail('alice@getodk.org')
          .then((maybeAlice) => maybeAlice.get())
          .then((alice) => service.login('alice', (asAlice) =>
            asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
              .then((adminRoleId) => asAlice.delete(`/v1/assignments/${adminRoleId}/${alice.actor.id}`)
                .expect(200)
                .then(() => Audits.getLatestByAction('user.assignment.delete'))
                .then((audit) => {
                  audit.isDefined().should.equal(true);
                  audit.get().actorId.should.equal(alice.actor.id);
                  audit.get().acteeId.should.equal(alice.actor.acteeId);
                  audit.get().details.should.eql({ roleId: adminRoleId, revokedActeeId: '*' });
                }))))));
    });
  });
});

describe('/projects/:id/assignments', () => {
  describe('GET', () => {
    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/assignments').expect(403))));

    it('should return notfound if the project does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/99/assignments').expect(404))));

    it('should list all assignments', testService((service) =>
      service.login('bob', (asBob) => Promise.all([
        asBob.get('/v1/roles/manager').expect(200).then(({ body }) => body.id),
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
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/99/assignments/manager').expect(404))));

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
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/assignments/manager/999')
          .expect(404))));

    it('should not permit granting rights one does not have', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((chelseaId) => service.login('bob', (asBob) =>
            asBob.post(`/v1/projects/1/assignments/admin/${chelseaId}`)
              .expect(403))))));

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
          asChelsea.get('/v1/roles/manager').expect(200).then(({ body }) => body.id),
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

    it('should log the action in the audit log', testService((service, { Audits, Projects, Users }) =>
      Users.getByEmail('chelsea@getodk.org')
        .then((maybeChelsea) => maybeChelsea.get())
        .then((chelsea) => service.login('alice', (asAlice) =>
          asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
            .then((adminRoleId) => asAlice.post(`/v1/projects/1/assignments/${adminRoleId}/${chelsea.actor.id}`)
              .expect(200)
              .then(() => Promise.all([
                Projects.getById(1).then((x) => x.get()),
                Users.getByEmail('alice@getodk.org').then((maybeAlice) => maybeAlice.get()),
                Audits.getLatestByAction('user.assignment.create')
              ]))
              .then(([ project, alice, audit ]) => {
                audit.isDefined().should.equal(true);
                audit.get().actorId.should.equal(alice.actor.id);
                audit.get().acteeId.should.equal(chelsea.actor.acteeId);
                audit.get().details.should.eql({ roleId: adminRoleId, grantedActeeId: project.acteeId });
              }))))));
  });

  describe('/:roleId/:actorId DELETE', () => {
    it('should prohibit unprivileged users from deleting assignments', testService((service) =>
      service.login('bob', (asBob) => service.login('chelsea', (asChelsea) =>
        asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((bobId) => asChelsea.delete('/v1/projects/1/assignments/manager/' + bobId)
            .expect(403))))));

    it('should return notfound if the project does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((bobId) => asAlice.delete('/v1/projects/99/assignments/manager/' + bobId)
              .expect(404))))));

    it('should return notfound if the role does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
            .then((bobId) => asAlice.delete('/v1/projects/1/assignments/99/' + bobId)
              .expect(404))))));

    it('should return notfound if the user does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/assignments/manager/999')
          .expect(404))));

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
          asBob.get('/v1/roles/manager').expect(200).then(({ body }) => body.id),
          asBob.get('/v1/users/current').expect(200).then(({ body }) => body.id)
        ])
          .then(([ roleId, bobId ]) => asBob.delete(`/v1/projects/1/assignments/${roleId}/${bobId}`)
            .expect(200)
            // verify a different way:
            .then(() => service.login('alice', (asAlice) =>
              asAlice.get('/v1/projects/1/assignments/manager')
                .expect(200)
                .then(({ body }) => { body.length.should.equal(0); })))))));

    it('should log the action in the audit log', testService((service, { Audits, Projects, Users }) =>
      Users.getByEmail('bob@getodk.org')
        .then((maybeBob) => maybeBob.get())
        .then((bob) => service.login('alice', (asAlice) =>
          asAlice.get('/v1/roles/manager').expect(200).then(({ body }) => body.id)
            .then((managerRoleId) => asAlice.delete(`/v1/projects/1/assignments/${managerRoleId}/${bob.actor.id}`)
              .expect(200)
              .then(() => Promise.all([
                Projects.getById(1).then((x) => x.get()),
                Users.getByEmail('alice@getodk.org').then((x) => x.get()),
                Audits.getLatestByAction('user.assignment.delete')
              ]))
              .then(([ project, alice, audit ]) => {
                audit.isDefined().should.equal(true);
                audit.get().actorId.should.equal(alice.actor.id);
                audit.get().acteeId.should.equal(bob.actor.acteeId);
                audit.get().details.should.eql({ roleId: managerRoleId, revokedActeeId: project.acteeId });
              }))))));
  });
});

describe('api: /projects/:projectId/forms/:xmlFormId/assignments', () => {
  it('should return all form assignments', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'david' })
        .expect(200)
        .then(({ body }) => body)
        .then((fk) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
          .expect(200)
          .then(() => Promise.all([
            asAlice.get('/v1/projects/1/forms/simple/assignments').then(({ body }) => body),
            asAlice.get('/v1/roles/app-user').then(({ body }) => body.id)
          ]))
          .then(([ result, appUserRoleId ]) => {
            result.should.eql([{ actorId: fk.id, roleId: appUserRoleId }]);
          })))));

  it('should return all form assignments for a role', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'david' })
        .expect(200)
        .then(({ body }) => body)
        .then((fk) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple/assignments/app-user')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.an.Actor();
              body[0].displayName.should.equal('david');
            }))))));

  // we don't bother testing POST since none of the other tests here work without it.

  it('should delete assignments', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'david' })
        .expect(200)
        .then(({ body }) => body)
        .then((fk) => asAlice.post(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
          .expect(200)
          .then(() => asAlice.delete(`/v1/projects/1/forms/simple/assignments/app-user/${fk.id}`)
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/assignments/app-user')
            .expect(200)
            .then(({ body }) => { body.length.should.equal(0); }))))));

});

