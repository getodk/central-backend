const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
const { createUser, promoteUser, setUserPassword } = require(appRoot + '/lib/task/account');
const { User } = require(appRoot + '/lib/model/frames');

describe('task: accounts', () => {
  describe('createUser', () => {
    it('should create a user account', testTask(({ Users }) =>
      createUser('testuser@opendatakit.org', 'aoeu')
        .then((result) => {
          result.email.should.equal('testuser@opendatakit.org');
          return Users.getByEmail('testuser@opendatakit.org')
            .then((user) => user.isDefined().should.equal(true));
        })));

    it('should log an audit entry', testTask(({ Audits, Users }) =>
      createUser('testuser@opendatakit.org', 'aoeu')
        .then((result) => Promise.all([
          Users.getByEmail('testuser@opendatakit.org').then((o) => o.get()),
          Audits.getLatestByAction('user.create').then((o) => o.get())
        ]))
        .then(([ user, log ]) => {
          log.acteeId.should.equal(user.actor.acteeId);
          log.details.data.email.should.equal(user.email);
        })));
  });

  describe('promoteUser', () => {
    // TODO: for now, we simply check if the user can create a nonexistent actee
    // species to verify the */* grant. eventually we should be more precise.
    it('should promote a user account to admin', testTask(({ Auth, Users }) =>
      Users.create(User.fromApi({ email: 'testuser@opendatakit.org', displayName: 'test user' }))
        .then((user) => Auth.can(user.actor, 'user.create', User.species))
        .then((allowed) => {
          allowed.should.equal(false);
          return promoteUser('testuser@opendatakit.org')
            .then(() => Users.getByEmail('testuser@opendatakit.org')
              .then(getOrNotFound)
              .then((user) => Auth.can(user.actor, 'user.create', User.species))
              .then((allowed) => allowed.should.equal(true)));
        })));

    it('should log an audit entry', testTask(({ Audits, Roles, Users }) =>
      Users.create(User.fromApi({ email: 'testuser@opendatakit.org', displayName: 'test user' }))
        .then((user) => promoteUser('testuser@opendatakit.org')
          .then(() => Promise.all([
            Audits.getLatestByAction('assignment.create').then((o) => o.get()),
            Roles.getBySystemName('admin').then((o) => o.get())
          ]))
          .then(([ log, role ]) => {
            log.acteeId.should.equal(user.actor.acteeId);
            log.details.roleId.should.equal(role.id);
            log.details.grantedActeeId.should.equal('*');
          }))));
  });

  describe('setUserPassword', () => {
    it('should set a user password', testTask(({ Users, bcrypt }) =>
      Users.create(User.fromApi({ email: 'testuser@opendatakit.org', displayName: 'test user' }))
        .then(() => setUserPassword('testuser@opendatakit.org', 'aoeu'))
        .then(() => Users.getByEmail('testuser@opendatakit.org'))
        .then(getOrNotFound)
        .then((user) => bcrypt.verify('aoeu', user.password))
        .then((verified) => verified.should.equal(true))));

    it('should log an audit entry', testTask(({ Audits, Users }) =>
      Users.create(User.fromApi({ email: 'testuser@opendatakit.org', displayName: 'test user' }))
        .then(() => setUserPassword('testuser@opendatakit.org', 'aoeu'))
        .then(() => Promise.all([
          Audits.getLatestByAction('user.update').then((o) => o.get()),
          Users.getByEmail('testuser@opendatakit.org').then((o) => o.get())
        ])
        .then(([ log, user ]) => {
          log.acteeId.should.equal(user.actor.acteeId);
          log.details.data.should.eql({ password: true });
        }))));
  });
});

