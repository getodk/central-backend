
const { wasUpdateSuccessful } = require('../../util/db');
const Option = require('../../reused/option');

module.exports = {
  create: (user) => ({ actors, simply }) =>
    actors.transacting
      .create(user.actor)
      .then((savedActor) => simply.create('users', user.with({ actor: savedActor }))
        .then((savedUser) => savedUser.with({ actor: savedActor }))),

  update: (user) => ({ all, users, simply }) =>
    all.transacting.areTrue([
      users._update(user.actor.id, user.forUpdate()),
      simply.update('actors', user.actor)
    ]),

  updatePassword: (user, hash) => ({ users }) =>
    users._update(user.actorId, { password: hash }),

  // necessary since the users table is driven by actorId rather than id.
  // NOTE: does not call forUpdate (takes databag directly), as updating the auth
  // fields are gated on different operations.
  _update: (actorId, data) => ({ db }) =>
    db.update(data).into('users').where({ actorId })
      .then(wasUpdateSuccessful),

  getAll: () => ({ users }) => users._get(),

  getOneWhere: (condition) => ({ users }) =>
    users._get(condition).then((rows) => Option.of(rows[0])),

  _get: (condition) => ({ User, db }) => {
    const select = db.select('*').from('users')
      .join('actors', 'users.actorId', 'actors.id');
    if (condition != null) select.where(condition);
    return select.then((users) => users.map(User.fromApi)); // TODO: naming; see User.fromApi def.
  }
};

