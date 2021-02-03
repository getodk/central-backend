const appRoot = require('app-root-path');
const { User, Actor } = require(appRoot + '/lib/model/frames');
const { mapSequential } = require(appRoot + '/lib/util/promise');

module.exports = ({ Assignments, Users, Projects, bcrypt }) => {
  const users = [
    { type: 'user', email: 'alice@opendatakit.org', password: 'alice', displayName: 'Alice' },
    { type: 'user', email: 'bob@opendatakit.org', password: 'bob', displayName: 'Bob' },
    { type: 'user', email: 'chelsea@opendatakit.org', password: 'chelsea', displayName: 'Chelsea' } ]
    .map((data) => User.fromData(data));

  // hash the passwords, create our three test users, then add grant Alice and Bob their rights.
  const withPasswords = Promise.all(users.map((user) =>
    bcrypt.hash(user.password).then((password) => user.with({ password }))))

  return withPasswords
    .then((users) => mapSequential(users, Users.create))
    .then(([ alice, bob, chelsea ]) => Promise.all([
      Assignments.grantSystem(alice.actor, 'admin', '*'),
      Projects.getById(1).then((project) => Assignments.grantSystem(bob.actor, 'manager', project.get()))
    ]));
};

