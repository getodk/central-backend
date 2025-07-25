const appRoot = require('app-root-path');
const should = require('should');
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
const { testService } = require('../setup');
const { describe } = require('mocha');

describe('api: /users', () => {
  describe('GET', () => {
    it('should reject for anonymous users', testService((service) =>
      service.get('/v1/users').expect(401)));

    it('should return nothing for authed users who cannot user.list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users')
          .expect(200)
          .then(({ body }) => { body.should.eql([]); }))));

    it('should return a list of sorted users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users')
          .expect(200)
          .expect(({ body }) => {
            body.forEach((user) => user.should.be.a.User());
            body.map((user) => user.displayName).should.eql([ 'Alice', 'Bob', 'Chelsea' ]);
            body.map((user) => user.email).should.eql([ 'alice@getodk.org', 'bob@getodk.org', 'chelsea@getodk.org' ]);
          }))));

    it('should search user display names if a query is given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'test@email.org', displayName: 'alicia' })
          .expect(200)
          .then(() => asAlice.get('/v1/users?q=alice')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body.forEach((user) => user.should.be.a.User());
              body.map((user) => user.displayName).should.eql([ 'Alice', 'alicia' ]);
              body.map((user) => user.email).should.eql([ 'alice@getodk.org', 'test@email.org' ]);
            })))));

    it('should search user emails if a query is given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/users')
          .send({ email: 'david@closeddatakit.org', displayName: 'David' })
          .expect(200)
          .then(() => asAlice.get('/v1/users?q=getodk')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body.forEach((user) => user.should.be.a.User());
              body.map((user) => user.displayName).should.containDeep([ 'Alice', 'Bob', 'Chelsea' ]);
              body.map((user) => user.email).should.containDeep([ 'alice@getodk.org', 'bob@getodk.org', 'chelsea@getodk.org' ]);
            })))));

    it('should search with compound phrases if given', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users?q=chelsea getodk')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(3);
            body.forEach((user) => user.should.be.a.User());
            // bob always comes ahead of alice, since the email is shorter and so it's
            // technically more of a match.
            body.map((user) => user.displayName).should.eql([ 'Chelsea', 'Bob', 'Alice' ]);
          }))));

    it('should reject unauthed users even if they exactly match an email', testService((service) =>
      service.get('/v1/users/?q=alice@getodk.org').expect(401)));

    it('should return an exact email match to any authed user', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/?q=alice@getodk.org')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].email.should.equal('alice@getodk.org');
            body[0].displayName.should.equal('Alice');
          }))));
  });

  describe('POST', () => {
    it('should prohibit non-admins from creating users', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/users')
          .send({ email: 'david@getodk.org' })
          .expect(403))));

    if (process.env.TEST_AUTH === 'oidc') {
      describe('with OIDC auth', () => {
        it('should send an email to provisioned users', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org' })
              .expect(200)
              .then(() => {
                const email = global.inbox.pop();
                global.inbox.length.should.equal(0);
                email.to.should.eql([{ address: 'david@getodk.org', name: '' }]);
                email.subject.should.equal('ODK Central account created');
              }))));

        it('should not send a token which can reset the new user password', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org' })
              .expect(200)
              .then(() => {
                const tokenMatch = /token=([a-z0-9!$]+)/i.exec(global.inbox.pop().html);
                should(tokenMatch).be.null();
              }))));
      });
    } else {
      describe('with standard uname/password auth', () => {
        it('should hash and store passwords if provided', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org', password: 'alongpassword' })
              .expect(200)
              .then(() => service.login({ email: 'david@getodk.org', password: 'alongpassword' }, (asDavid) =>
                asDavid.get('/v1/users/current').expect(200))))));

        it('should not accept and hash blank passwords', testService((service, { Users }) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org', password: '' })
              .expect(200) // treats a blank password as no password provided
              .then(() => Promise.all([
                service.post('/v1/sessions')
                  .send({ email: 'david@getodk.org', password: '' })
                  .expect(400),
                Users.getByEmail('david@getodk.org')
                  .then(getOrNotFound)
                  .then(({ password }) => { should.not.exist(password); })
              ])))));

        [
          [ 'too short', 'short' ],
          [ 'too long',  'loooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong' ], // eslint-disable-line no-multi-spaces
          [ 'object',    {} ], // eslint-disable-line no-multi-spaces
          [ 'array',     [] ], // eslint-disable-line no-multi-spaces
          [ 'number',    123 ], // eslint-disable-line no-multi-spaces
        ].forEach(([ description, password ]) => {
          it(`should not accept ${description} password`, testService((service) =>
            service.login('alice', (asAlice) =>
              asAlice.post('/v1/users')
                .send({ email: 'david@getodk.org', password })
                .expect(400))));
        });

        it('should send an email to provisioned users', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org', password: 'daviddavid' })
              .expect(200)
              .then(() => {
                const email = global.inbox.pop();
                global.inbox.length.should.equal(0);
                email.to.should.eql([{ address: 'david@getodk.org', name: '' }]);
                email.subject.should.equal('ODK Central account created');
              }))));

        it('should send a token which can reset the new user password', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org' })
              .expect(200)
              .then(() => {
                const token = /token=([a-z0-9!$]+)/i.exec(global.inbox.pop().html)[1];
                return service.post('/v1/users/reset/verify')
                  .send({ new: 'testresetpassword' })
                  .set('Authorization', 'Bearer ' + token)
                  .expect(200)
                  .then(() => service.login({ email: 'david@getodk.org', password: 'testresetpassword' }, (asDavid) =>
                    asDavid.get('/v1/users/current').expect(200)));
              }))));

        it('should not allow a too-short password when resetting via token', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org' })
              .expect(200)
              .then(() => {
                const token = /token=([a-z0-9!$]+)/i.exec(global.inbox.pop().html)[1];
                return service.post('/v1/users/reset/verify')
                  .send({ new: 'tooshort' })
                  .set('Authorization', 'Bearer ' + token)
                  .expect(400);
              }))));

        it('should send a message explaining a pre-assigned password if given', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org', password: 'daviddavid' })
              .expect(200)
              .then(() => {
                /Your account was created with an assigned password\./
                  .test(global.inbox.pop().html)
                  .should.equal(true);
              }))));

        it('should duplicate the email into the display name if not given', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org' })
              .then(({ body }) => body.displayName.should.equal('david@getodk.org')))));

        it('should log the action in the audit log', testService((service, { Audits, Users }) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users')
              .send({ email: 'david@getodk.org' })
              .expect(200)
              .then(() => Promise.all([
                Users.getByEmail('alice@getodk.org').then((o) => o.get()),
                Users.getByEmail('david@getodk.org').then((o) => o.get()),
                Audits.getLatestByAction('user.create').then((o) => o.get())
              ])
                .then(([ alice, david, log ]) => {
                  log.actorId.should.equal(alice.actor.id);
                  log.acteeId.should.equal(david.actor.acteeId);
                  log.details.data.actorId.should.be.a.Number();
                  // eslint-disable-next-line no-param-reassign
                  delete log.details.data.actorId;
                  log.details.should.eql({
                    data: {
                      email: 'david@getodk.org',
                      password: null
                    }
                  });
                })))));
      });
    }
  });

  describe('/reset/initiate POST, /reset/verify POST', () => {
    if (process.env.TEST_AUTH === 'oidc') {
      describe('with OIDC auth', () => {
        it('should not expose /reset/initiate', testService((service) =>
          service.post('/v1/users/reset/initiate')
            .send({ email: 'winnifred@getodk.org' })
            .expect(404)));

        it('should not expose /reset/verify', testService((service) =>
          service.post('/v1/users/reset/verify')
            .send({ new: 'resetthis!' })
            .set('Authorization', 'Bearer asdf')
            .expect(404)));
      });
    } else {
      describe('with standard uname/password auth', () => {
        it('should not send any email if no account exists', testService((service) =>
          service.post('/v1/users/reset/initiate')
            .send({ email: 'winnifred@getodk.org' })
            .expect(200)
            .then(() => {
              global.inbox.length.should.equal(0);
            })));

        it('should send a specific email if an account existed but was deleted', testService((service) =>
          service.login('alice', (asAlice) =>
            service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/users/current')
                .then(({ body }) => body.id)
                .then((chelseaId) => asAlice.delete('/v1/users/' + chelseaId)
                  .expect(200)
                  .then(() => service.post('/v1/users/reset/initiate')
                    .send({ email: 'chelsea@getodk.org' })
                    .expect(200)
                    .then(() => {
                      const email = global.inbox.pop();
                      global.inbox.length.should.equal(0);
                      email.to.should.eql([{ address: 'chelsea@getodk.org', name: '' }]);
                      email.subject.should.equal('ODK Central account password reset');
                      email.html.should.match(/account has been deleted/);
                    })))))));

        it('should send an email with a token which can reset the user password', testService((service) =>
          service.post('/v1/users/reset/initiate')
            .send({ email: 'alice@getodk.org' })
            .expect(200)
            .then(() => {
              const email = global.inbox.pop();
              global.inbox.length.should.equal(0);
              email.to.should.eql([{ address: 'alice@getodk.org', name: '' }]);
              email.subject.should.equal('ODK Central account password reset');
              const token = /token=([a-z0-9!$]+)/i.exec(email.html)[1];

              return service.post('/v1/users/reset/verify')
                .send({ new: 'resetthis!' })
                .set('Authorization', 'Bearer ' + token)
                .expect(200)
                .then(() => service.login({ email: 'alice@getodk.org', password: 'resetthis!' }, (asAlice) =>
                  asAlice.get('/v1/users/current').expect(200)));
            })));

        it('should delete sessions after password reset', testService(async (service) => {
          const asAlice = await service.login('alice');
          await service.post('/v1/users/reset/initiate')
            .send({ email: 'alice@getodk.org' })
            .expect(200);
          // The session has not been deleted yet.
          await asAlice.get('/v1/users/current').expect(200);

          const token = /token=([a-z0-9!$]+)/i.exec(global.inbox.pop().html)[1];
          await service.post('/v1/users/reset/verify')
            .send({ new: 'resetpassword' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
          // The session has been deleted.
          await asAlice.get('/v1/users/current').expect(401);
        }));

        it('should not allow password reset token replay', testService((service) =>
          service.post('/v1/users/reset/initiate')
            .send({ email: 'alice@getodk.org' })
            .expect(200)
            .then(() => /token=([a-z0-9!$]+)/i.exec(global.inbox.pop().html)[1])
            .then((token) => service.post('/v1/users/reset/verify')
              .send({ new: 'reset the first time!' })
              .set('Authorization', 'Bearer ' + token)
              .expect(200)
              .then(() => service.post('/v1/users/reset/verify')
                .send({ new: 'reset again!' })
                .set('Authorization', 'Bearer ' + token)
                .expect(401)))));

        it('should not log single use token deletion in the audit log', testService((service) =>
          service.post('/v1/users/reset/initiate')
            .send({ email: 'alice@getodk.org' })
            .expect(200)
            .then(() => /token=([a-z0-9!$]+)/i.exec(global.inbox.pop().html)[1])
            .then((token) => service.post('/v1/users/reset/verify')
              .send({ new: 'resetpassword' })
              .set('Authorization', 'Bearer ' + token)
              .expect(200))
            .then(() => service.get('/v1/audits')
              .auth('alice@getodk.org', 'resetpassword') // cheap way to work around that we just changed the pw
              .set('x-forwarded-proto', 'https')
              .then(({ body }) => {
                body[0].action.should.equal('user.update');
                body[0].details.data.should.eql({ password: true });
              }))));

        it('should fail the request if invalidation is requested and no auth provided', testService((service) =>
          service.post('/v1/users/reset/initiate?invalidate=true')
            .send({ email: 'alice@getodk.org' })
            .expect(401)));

        it('should fail the request if invalidation is requested but user is not authorized', testService((service) =>
          service.login('chelsea', (asChelsea) =>
            asChelsea.post('/v1/users/reset/initiate?invalidate=true')
              .send({ email: 'alice@getodk.org' })
              .expect(403))));

        it('should invalidate the existing password if requested', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users/reset/initiate?invalidate=true')
              .send({ email: 'bob@getodk.org' })
              .expect(200)
              .then(() => {
                // should still send the email.
                const email = global.inbox.pop();
                global.inbox.length.should.equal(0);
                email.to.should.eql([{ address: 'bob@getodk.org', name: '' }]);
                email.subject.should.equal('ODK Central account password reset');

                return service.post('/v1/sessions')
                  .send({ email: 'bob@getodk.org', password: 'password4bob' })
                  .expect(401);
              }))));

        it('should clear sessions if password is invalidated', testService(async (service) => {
          // Log in as Bob twice.
          const [asAlice, ...asBobs] = await service.login(['alice', 'bob', 'bob']);
          await Promise.all(asBobs.map(asBob => asBob.get('/v1/users/current')
            .expect(200)));
          await asAlice.post('/v1/users/reset/initiate?invalidate=true')
            .send({ email: 'bob@getodk.org' })
            .expect(200);
          await Promise.all(asBobs.map(asBob => asBob.get('/v1/users/current')
            .expect(401)));
        }));

        it('should log action in audit log if password is invalidated', testService(async (service) => {
          const asAlice = await service.login('alice');
          await asAlice.post('/v1/users/reset/initiate?invalidate=true')
            .send({ email: 'bob@getodk.org' })
            .expect(200);
          const { body: audits } = await asAlice.get('/v1/audits?action=user.update')
            .set('X-Extended-Metadata', 'true')
            .expect(200);
          audits.length.should.equal(1);
          const audit = audits[0];
          audit.actor.displayName.should.equal('Alice');
          audit.actee.displayName.should.equal('Bob');
          audit.details.should.eql({ data: { password: null } });
        }));

        it('should fail the request if invalidation is not allowed and email doesn\'t exist', testService((service) =>
          service.login('chelsea', (asChelsea) =>
            asChelsea.post('/v1/users/reset/initiate?invalidate=true')
              .send({ email: 'winnifred@getodk.org' })
              .expect(403))));

        it('should return 200 if user has rights to invalidate but account doesn\'nt exist', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users/reset/initiate?invalidate=true')
              .send({ email: 'winnifred@getodk.org' })
              .expect(200)
              .then(() => {
                global.inbox.length.should.equal(0);
              }))));

        it('should not allow a user to reset their own password directly', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users/reset/verify')
              .send({ new: 'coolpassword' })
              .expect(403))));

        it('should fail the request if email field is sent blank in request body', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.post('/v1/users/reset/initiate')
              .send({ email: '' })
              .expect(400)
              .then(({ body: { code, details } }) => {
                details.should.eql({ field: 'email' });
                code.should.eql(400.2);
              }))));
      });
    }
  });

  describe('/users/current GET', () => {
    it('should return unauthenticated if nobody is logged in', testService((service) =>
      service.get('/v1/users/current').expect(401)));

    it('should give the authed user if logged in', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => body.email.should.equal('chelsea@getodk.org')))));

    it('should not return sidewide verbs if not extended', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => { should.not.exist(body.verbs); }))));

    it('should return sidewide verbs if logged in (alice)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.verbs.should.be.an.Array();
            // we leave this vagueish so we don't tie ourselves too deeply to the current
            // set of verbs, etc. just check for a lot, and some high-powered verbs.
            body.verbs.length.should.be.greaterThan(30);
            body.verbs.should.containDeep([ 'user.password.invalidate', 'assignment.create', 'role.update' ]);
          }))));

    it('should return sidewide verbs if logged in (chelsea)', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.verbs.should.be.an.Array();
            body.verbs.length.should.equal(0);
          }))));

    it('should return 404 for app user', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test' })
          .expect(200)
          .then(({ body }) => body)
          .then((fk) => service.get(`/v1/key/${fk.token}/users/current`)
            .expect(404)))));

    it('should return 404 for public link', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'link1' })
          .expect(200)
          .then(({ body }) => body)
          .then((link) => service.get(`/v1/users/current?st=${link.token}`)
            .expect(404)))));
  });

  describe('/users/:id GET', () => {
    it('should reject if the authed user cannot get', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => service.login('chelsea', (asChelsea) =>
            asChelsea.get(`/v1/users/${body.id}`).expect(403))))));

    it('should return the requested user', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => asAlice.get(`/v1/users/${body.id}`)
            .expect(200)
            // eslint-disable-next-line no-shadow
            .then(({ body }) => {
              body.should.be.a.User();
              body.email.should.equal('alice@getodk.org');
            })))));

    it('should allow non-admins to get themselves', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((chelseaId) => asChelsea.get('/v1/users/' + chelseaId)
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.User();
              body.email.should.equal('chelsea@getodk.org');
            })))));

    it('should reject if the user does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/99').expect(404))));
  });

  describe('/users/:id PATCH', () => {
    it('should reject non-admins from updating a different user', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => service.login('chelsea', (asChelsea) =>
            asChelsea.patch(`/v1/users/${body.id}`)
              .send({ displayName: 'not alice' })
              .expect(403))))));

    it('should reject if the user id cannot be found', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/users/99999')
          .send({ displayName: 'test' })
          .expect(404))));

    it('should update only the allowed fields', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.get('/v1/users/current')
          .expect(200)
          .then((before) => asBob.patch(`/v1/users/${before.body.id}`)
            .send({
              id: 9999,
              type: 'exahacker',
              password: 'password',
              email: 'newbob@odk.org',
              displayName: 'new bob',
              meta: { test: 'new meta' },
              createdAt: '2006-01-01T00:00:00',
              updatedAt: '2006-01-01T00:00:00',
              deletedAt: '2006-01-01T00:00:00'
            })
            .expect(200)
            .then((after) => {
              before.body.id.should.equal(after.body.id);
              after.body.displayName.should.equal('new bob');
              should.not.exist(after.body.meta);
              before.body.createdAt.should.equal(after.body.createdAt);
              after.body.updatedAt.should.be.a.recentIsoDate();

              if (process.env.TEST_AUTH === 'oidc') {
                after.body.email.should.equal('bob@getodk.org');
                return service.authenticateUser('bob');
              } else {
                after.body.email.should.equal('newbob@odk.org');
                return service.post('/v1/sessions')
                  .send({ email: 'newbob@odk.org', password: 'password4bob' })
                  .expect(200);
              }
            })))));

    it('should allow non-admins to update themselves', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
          .then((chelseaId) => asChelsea.patch('/v1/users/' + chelseaId)
            .send({ displayName: 'a new display name' })
            .expect(200)
            .then(() => asChelsea.get('/v1/users/' + chelseaId)
              .then(({ body }) => {
                body.should.be.a.User();
                body.email.should.equal('chelsea@getodk.org');
                body.displayName.should.equal('a new display name');
              }))))));

    it('should allow admins to update another user', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current')
            .expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => asAlice.patch('/v1/users/' + chelseaId)
              .send({ displayName: 'a new display name', email: 'millwall@getodk.org' })
              .expect(200)
              .then(() => asChelsea.get('/v1/users/' + chelseaId)
                .then(({ body }) => {
                  body.should.be.a.User();
                  body.email.should.equal('millwall@getodk.org');
                  body.displayName.should.equal('a new display name');
                })))))));

    if (process.env.TEST_AUTH !== 'oidc') {
      it('should send an email to the user\'s previous email when their email changes', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/users/current')
            .expect(200)
            .then((before) => asAlice.patch(`/v1/users/${before.body.id}`)
              .send({ email: 'david123@getodk.org' })
              .expect(200)
              .then(() => {
                const email = global.inbox.pop();
                global.inbox.length.should.equal(0);
                email.to.should.eql([{ address: 'alice@getodk.org', name: '' }]);
                email.subject.should.equal('ODK Central account email changed');
                email.html.should.equal('<html>Hello!<p><p>We are emailing because you have an ODK Central account, and somebody has just changed the email address associated with the account from this one you are reading right now (alice@getodk.org) to a new address (david123@getodk.org).</p><p>If this is expected, you can ignore this email. If it is not expected, please contact your ODK system administrator immediately.</p></html>');
              })))));
    }

    it('should not send an email to a user when their email does not change', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then((before) => asAlice.patch(`/v1/users/${before.body.id}`)
            .send({ email: 'alice@getodk.org' })
            .expect(200)
            .then(() => {
              global.inbox.length.should.equal(0);
            })))));

    it('should log the action in the audit log', testService((service, { Users, Audits }) =>
      service.login('alice', (asAlice) =>
        Users.getByEmail('chelsea@getodk.org').then((o) => o.get())
          .then((chelsea) => asAlice.patch('/v1/users/' + chelsea.actor.id)
            .send({ displayName: 'cool chelsea', other: 'data' })
            .expect(200)
            .then(() => Promise.all([
              Users.getByEmail('alice@getodk.org').then((o) => o.get()),
              Audits.getLatestByAction('user.update').then((o) => o.get())
            ])
              .then(([ alice, log ]) => {
                log.actorId.should.equal(alice.actor.id);
                log.acteeId.should.equal(chelsea.actor.acteeId);
                log.details.should.eql({ data: { displayName: 'cool chelsea' } });
              }))))));
  });

  describe('/users/:id/password PUT', () => {
    if (process.env.TEST_AUTH === 'oidc') {
      describe('with OIDC auth', () => {
        it('should not expose this endpoint', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => asAlice.put(`/v1/users/${body.id}/password`)
                .send({ old: 'password4alice', new: 'newpassword' })
                .expect(404)))));
      });
    } else {
      describe('with standard uname/password auth', () => {
        it('should reject if the authed user cannot update', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => service.login('chelsea', (asChelsea) =>
                asChelsea.put(`/v1/users/${body.id}/password`)
                  .send({ old: 'password4alice', new: 'chelsea' })
                  .expect(403))))));

        it('should reject if the user does not exist', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.put('/v1/users/9999/password')
              .send({ old: 'password4alice', new: 'password4chelsea' })
              .expect(404))));

        it('should reject if the old password is not correct', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => asAlice.put(`/v1/users/${body.id}/password`)
                .send({ old: 'notalice', new: 'newpassword' })
                .expect(401)))));

        it('should change the password', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => asAlice.put(`/v1/users/${body.id}/password`)
                .send({ old: 'password4alice', new: 'newpassword' })
                .expect(200))
              .then(({ body }) => {
                body.success.should.equal(true);
                return service.post('/v1/sessions')
                  .send({ email: 'alice@getodk.org', password: 'newpassword' })
                  .expect(200);
              }))));

        it('should disallow a password that is too short (<10 chars)', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => asAlice.put(`/v1/users/${body.id}/password`)
                .send({ old: 'password4alice', new: '123456789' })
                .expect(400))))); // 400.21

        it('should allow nonadministrator users to set their own password', testService((service) =>
          service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/users/current').expect(200).then(({ body }) => body.id)
              .then((chelseaId) => asChelsea.put(`/v1/users/${chelseaId}/password`)
                .send({ old: 'password4chelsea', new: 'newchelsea' })
                .expect(200)
                .then(() => service.post('/v1/sessions')
                  .send({ email: 'chelsea@getodk.org', password: 'newchelsea' })
                  .expect(200))))));

        it('should delete other sessions', testService(async (service) => {
          const asAlice = await service.login('alice');
          const anotherAlice = await service.login('alice');
          const { body: { id } } = await asAlice.get('/v1/users/current')
            .expect(200);
          await anotherAlice.get('/v1/users/current').expect(200);
          await asAlice.put(`/v1/users/${id}/password`)
            .send({ old: 'password4alice', new: 'newpassword' })
            .expect(200);
          // The other session has been deleted.
          await anotherAlice.get('/v1/users/current').expect(401);
          // The current session has not.
          await asAlice.get('/v1/users/current').expect(200);
        }));

        it('should delete sessions if Basic auth is used', testService(async (service) => {
          const asAlice = await service.login('alice');
          const { body: { id } } = await asAlice.get('/v1/users/current')
            .expect(200);
          const basic = Buffer.from('alice@getodk.org:password4alice').toString('base64');
          await service.put(`/v1/users/${id}/password`)
            .set('Authorization', `Basic ${basic}`)
            .set('X-Forwarded-Proto', 'https')
            .send({ old: 'password4alice', new: 'newpassword' })
            .expect(200);
          await asAlice.get('/v1/users/current').expect(401);
        }));

        it('should send an email to a user when their password changes', testService((service) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => asAlice.put(`/v1/users/${body.id}/password`)
                .send({ old: 'password4alice', new: 'newpassword' })
                .expect(200)
                .then(() => {
                  const email = global.inbox.pop();
                  global.inbox.length.should.equal(0);
                  email.to.should.eql([{ address: 'alice@getodk.org', name: '' }]);
                  email.subject.should.equal('ODK Central account password change');
                })))));

        it('should log an audit on password change', testService((service, { Audits, Users }) =>
          service.login('alice', (asAlice) =>
            asAlice.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => asAlice.put(`/v1/users/${body.id}/password`)
                .send({ old: 'password4alice', new: 'newpassword' })
                .expect(200)
                .then(() => Promise.all([
                  Users.getByEmail('alice@getodk.org').then((o) => o.get()),
                  Audits.getLatestByAction('user.update').then((o) => o.get())
                ]))
                .then(([ alice, log ]) => {
                  log.actorId.should.equal(alice.actor.id);
                  log.details.should.eql({ data: { password: true } });
                  log.acteeId.should.equal(alice.actor.acteeId);
                })))));
      });
    }
  });

  describe('/users/:id DELETE', () => {
    it('should reject if the authed user cannot delete', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users/current')
          .expect(200)
          .then(({ body }) => service.login('chelsea', (asChelsea) =>
            asChelsea.delete(`/v1/users/${body.id}`)
              .expect(403))))));

    it('should reject if the user does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/users/999')
          .expect(404))));

    it('should delete the user', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current')
            .expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => asAlice.delete('/v1/users/' + chelseaId)
              .expect(200)
              .then(() => asAlice.get('/v1/users/' + chelseaId)
                .expect(404)))))));

    it('should delete any assignments the user had', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current')
            .expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => asAlice.post('/v1/assignments/admin/' + chelseaId)
              .expect(200)
              .then(() => asAlice.delete('/v1/users/' + chelseaId)
                .expect(200))
              .then(() => asAlice.get('/v1/assignments/admin')
                .expect(200)
                .then(({ body }) => {
                  body.map((actor) => actor.id).includes(chelseaId).should.equal(false);
                })))))));

    it('should log an audit upon delete', testService((service, { Audits, Users }) =>
      service.login('alice', (asAlice) =>
        Users.getByEmail('chelsea@getodk.org')
          .then((maybeChelsea) => maybeChelsea.get())
          .then((chelsea) => asAlice.delete('/v1/users/' + chelsea.actor.id)
            .expect(200)
            .then(() => Promise.all([
              Audits.getLatestByAction('user.delete'),
              asAlice.get('/v1/users/current').then(({ body }) => body.id)
            ])
              .then(([ audit, aliceId ]) => {
                audit.isDefined().should.equal(true);
                audit.get().actorId.should.equal(aliceId);
                audit.get().acteeId.should.equal(chelsea.actor.acteeId);
              }))))));

    it('should prevent login after delete', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current')
            .expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => asAlice.delete('/v1/users/' + chelseaId)
              .expect(200)
              .then(async () => {
                if (process.env.TEST_AUTH === 'oidc') {
                  try {
                    await service.authenticateUser('chelsea');
                    should.fail();
                  } catch (err) {
                    err.message.should.equal('expected 200 "OK", got 303 "See Other"');
                  }
                } else {
                  return service.post('/v1/sessions')
                    .send({ email: 'chelsea@getodk.org', password: 'password4chelsea' })
                    .expect(401);
                }
              }))))));

    it('should disable active sessions', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('chelsea', (asChelsea) =>
          asChelsea.get('/v1/users/current')
            .expect(200)
            .then(({ body }) => body.id)
            .then((chelseaId) => asAlice.delete('/v1/users/' + chelseaId)
              .expect(200)
              .then(() => asChelsea.get('/v1/projects')
                .expect(401)))))));
  });
});

