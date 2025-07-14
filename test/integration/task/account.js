const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { verifyPassword } = require(appRoot + '/lib/util/crypto');
const { createUser, promoteUser, setUserPassword } = require(appRoot + '/lib/task/account');
const { User } = require(appRoot + '/lib/model/frames');

describe('task: accounts', () => {
  describe('createUser', () => {
    it('should create a user account with a password', testTask(({ Users }) =>
      createUser('testuser@getodk.org', 'aoeuidhtns')
        .then((result) => {
          result.email.should.equal('testuser@getodk.org');
          return Users.getByEmail('testuser@getodk.org')
            .then((user) => user.isDefined().should.equal(true));
        })));

    it('should create a user account with a null password', testTask(({ Users }) =>
      createUser('testuser@getodk.org', null)
        .then((result) => {
          result.email.should.equal('testuser@getodk.org');
          return Users.getByEmail('testuser@getodk.org')
            .then((user) => user.isDefined().should.equal(true));
        })));

    it('should log an audit entry', testTask(({ Audits, Users }) =>
      createUser('testuser@getodk.org', 'aoeuidhtns')
        .then(() => Promise.all([
          Users.getByEmail('testuser@getodk.org').then((o) => o.get()),
          Audits.getLatestByAction('user.create').then((o) => o.get())
        ]))
        .then(([ user, log ]) => {
          log.acteeId.should.equal(user.actor.acteeId);
          log.details.data.email.should.equal(user.email);
          should(log.details.data.password).equal(null);
        })));

    it('should set the password if given', testTask(({ Users }) =>
      createUser('testuser@getodk.org', 'aoeuidhtns')
        .then(() => Users.getByEmail('testuser@getodk.org'))
        .then((o) => o.get())
        .then((user) => verifyPassword('aoeuidhtns', user.password))
        .then((verified) => verified.should.equal(true))));

    it('should not verify a null password', testTask(({ Users }) =>
      createUser('testuser@getodk.org', null)
        .then(() => Users.getByEmail('testuser@getodk.org'))
        .then((o) => o.get())
        .then((user) => verifyPassword(null, user.password))
        .then((verified) => verified.should.equal(false))));

    it('should complain if the password is too short', testTask(() =>
      createUser('testuser@getodk.org', 'short')
        .catch((problem) => problem.problemCode.should.equal(400.21))));
  });

  describe('promoteUser', () => {
    // TODO: for now, we simply check if the user can create a nonexistent actee
    // species to verify the */* grant. eventually we should be more precise.
    it('should promote a user account to admin', testTask(({ Auth, Users }) =>
      Users.create(User.fromApi({ email: 'testuser@getodk.org', displayName: 'test user' }))
        .then((user) => Auth.can(user.actor, 'user.create', User.species))
        .then((allowed) => {
          allowed.should.equal(false);
          return promoteUser('testuser@getodk.org')
            .then(() => Users.getByEmail('testuser@getodk.org')
              .then((o) => o.get())
              .then((user) => Auth.can(user.actor, 'user.create', User.species))
              // eslint-disable-next-line no-shadow
              .then((allowed) => allowed.should.equal(true)));
        })));

    it('should log an audit entry', testTask(({ Audits, Roles, Users }) =>
      Users.create(User.fromApi({ email: 'testuser@getodk.org', displayName: 'test user' }))
        .then((user) => promoteUser('testuser@getodk.org')
          .then(() => Promise.all([
            Audits.getLatestByAction('user.assignment.create').then((o) => o.get()),
            Roles.getBySystemName('admin').then((o) => o.get())
          ]))
          .then(([ log, role ]) => {
            log.acteeId.should.equal(user.actor.acteeId);
            log.details.roleId.should.equal(role.id);
            log.details.grantedActeeId.should.equal('*');
          }))));
  });

  describe('setUserPassword', () => {
    it('should set a user password', testTask(({ Users }) =>
      Users.create(User.fromApi({ email: 'testuser@getodk.org', displayName: 'test user' }))
        .then(() => setUserPassword('testuser@getodk.org', 'aoeuidhtns'))
        .then(() => Users.getByEmail('testuser@getodk.org'))
        .then((o) => o.get())
        .then((user) => verifyPassword('aoeuidhtns', user.password))
        .then((verified) => verified.should.equal(true))));

    it('should complain about a password that is too short', testTask(({ Users }) =>
      Users.create(User.fromApi({ email: 'testuser@getodk.org', displayName: 'test user' }))
        .then(() => setUserPassword('testuser@getodk.org', 'aoeu'))
        .catch((problem) => problem.problemCode.should.equal(400.21))));

    it('should delete sessions', testTask(async ({ Sessions, Users }) => {
      const user = await Users.create(User.fromApi({
        email: 'testuser@getodk.org',
        displayName: 'test user'
      }));
      const { token } = await Sessions.create(user.actor);
      (await Sessions.getByBearerToken(token)).isDefined().should.be.true();
      await setUserPassword('testuser@getodk.org', 'aoeuidhtns');
      (await Sessions.getByBearerToken(token)).isDefined().should.be.false();
    }));

    it('should log an audit entry', testTask(({ Audits, Users }) =>
      Users.create(User.fromApi({ email: 'testuser@getodk.org', displayName: 'test user' }))
        .then(() => setUserPassword('testuser@getodk.org', 'aoeuidhtns'))
        .then(() => Promise.all([
          Audits.getLatestByAction('user.update').then((o) => o.get()),
          Users.getByEmail('testuser@getodk.org').then((o) => o.get())
        ])
          .then(([ log, user ]) => {
            log.acteeId.should.equal(user.actor.acteeId);
            log.details.data.should.eql({ password: true });
          }))));
  });
});

