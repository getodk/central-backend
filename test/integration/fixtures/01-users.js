const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { User, Actor, Project } = require(appRoot + '/lib/model/frames');
// eslint-disable-next-line import/no-dynamic-require
const { mapSequential } = require(appRoot + '/test/util/util');

module.exports = ({ Assignments, Users, Projects, bcrypt }) => {
  const proj = new Project({ name: 'Default Project' });

  const users = [
    new User({ email: 'alice@getodk.org', password: 'alice' }, { actor: new Actor({ type: 'user', displayName: 'Alice' }) }),
    new User({ email: 'bob@getodk.org', password: 'bob' }, { actor: new Actor({ type: 'user', displayName: 'Bob' }) }),
    new User({ email: 'chelsea@getodk.org', password: 'chelsea' }, { actor: new Actor({ type: 'user', displayName: 'Chelsea' }) })
  ];

  // hash the passwords, create our three test users, then add grant Alice and Bob their rights.
  const withPasswords = Promise.all(users.map((user) =>
    bcrypt.hash(user.password).then((password) => user.with({ password }))));

  return Projects.create(proj)
    .then(() => withPasswords)
    // eslint-disable-next-line no-shadow
    .then((users) => mapSequential(users, Users.create))
    .then(([ alice, bob ]) => Promise.all([
      Assignments.grantSystem(alice.actor, 'admin', '*'),
      Projects.getById(1).then((project) => Assignments.grantSystem(bob.actor, 'manager', project.get()))
    ]));
};

