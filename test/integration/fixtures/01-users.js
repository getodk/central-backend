
module.exports = ({ all, User, Actor, Membership, Project }) => {
  const users = [
    { email: 'alice@opendatakit.org', password: 'alice', displayName: 'Alice' },
    { email: 'bob@opendatakit.org', password: 'bob', displayName: 'Bob' },
    { email: 'chelsea@opendatakit.org', password: 'chelsea', displayName: 'Chelsea' } ]
    .map((data) => User.fromData(data));

  // hash the passwords, create our three test users, then add grant Alice and Bob their rights.
  return Promise.all(users.map((user) => user.withHashedPassword(user.password)))
    .then((users) => all.mapSequential(users, (user) => user.create()))
    .then(([ alice, bob, chelsea ]) => Promise.all([
      alice.actor.assignSystemRole('admin', '*'),
      Project.getById(1).then((project) => bob.actor.assignSystemRole('manager', project.get()))
    ]));
};

