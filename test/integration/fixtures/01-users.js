const appRoot = require('app-root-path');
const { User, Actor } = require(appRoot + '/lib/model/frames');
const { mapSequential } = require(appRoot + '/test/util/util');

module.exports = ({ Assignments, Users, Projects, bcrypt }) => {
  const users = [
    new User({ email: 'alice@opendatakit.org', password: 'alice' }, { actor: new Actor({ type: 'user', displayName: 'Alice' }) }),
    new User({ email: 'bob@opendatakit.org', password: 'bob' }, { actor: new Actor({ type: 'user', displayName: 'Bob' }) }),
    new User({ email: 'chelsea@opendatakit.org', password: 'chelsea' }, { actor: new Actor({ type: 'user', displayName: 'Chelsea' }) })
  ];

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

