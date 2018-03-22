
module.exports = ({ all, User, Actor, Membership }) => {
  const users = [
    { email: 'alice@opendatakit.org', password: 'alice', displayName: 'Alice' },
    { email: 'bob@opendatakit.org', password: 'bob', displayName: 'Bob' },
    { email: 'chelsea@opendatakit.org', password: 'chelsea', displayName: 'Chelsea' } ]
    .map(User.fromApi);

  // hash the passwords, create our three test users, then add Alice to administrators.
  // mark transaction so the whole thing happens in one commit rather than many (slow).
  return all.transacting.do(users.map((user) => user.withHashedPassword()))
    .then((users) => all.inOrder(users.map((user) => user.create())))
    .then(([ alice, bob, chelsea ]) => alice.actor.addToSystemGroup('admins'));
};

