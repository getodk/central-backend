const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { getOrNotFound } = require(appRoot + '/lib/util/promise');
const { verifyPassword } = require(appRoot + '/lib/util/crypto');
const { createUser, promoteUser, setUserPassword } = require(appRoot + '/lib/task/account');

describe('task: accounts', () => {
  describe('createUser', () => {
    it('should create a user account', testTask(({ User }, finalize) =>
      createUser('testuser@opendatakit.org', 'aoeu')
        .then((result) => {
          result.email.should.equal('testuser@opendatakit.org');
          return finalize(User.getByEmail('testuser@opendatakit.org'))
            .then((user) => user.isDefined().should.equal(true));
        })));
  });

  describe('promoteUser', () => {
    // TODO: for now, we simply check if the user can create a nonexistent actee
    // species to verify the */* grant. eventually we should be more precise.
    it('should promote a user account to admin', testTask(({ Actee, User }, finalize) =>
      finalize(User.fromApi({ email: 'testuser@opendatakit.org', displayName: 'test user' }).create())
        .then((user) => finalize(user.actor.can('create', Actee.species('nonexistent'))))
        .then((allowed) => {
          allowed.should.equal(false);
          return promoteUser('testuser@opendatakit.org')
            .then(() => finalize(User.getByEmail('testuser@opendatakit.org'))
              .then(getOrNotFound)
              .then((user) => finalize(user.actor.can('create', Actee.species('nonexistent'))))
              .then((allowed) => allowed.should.equal(true)));
        })));
  });

  describe('setUserPassword', () => {
    it('should set a user password', testTask(({ User }, finalize) =>
      finalize(User.fromApi({ email: 'testuser@opendatakit.org', displayName: 'test user' }).create())
        .then(() => setUserPassword('testuser@opendatakit.org', 'aoeu'))
        .then(() => finalize(User.getByEmail('testuser@opendatakit.org')))
        .then(getOrNotFound)
        .then((user) => finalize(verifyPassword('aoeu', user.password)))
        .then((verified) => verified.should.equal(true))));
  });
});

