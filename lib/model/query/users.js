const { wasUpdateSuccessful, maybeRowToInstance, rowsToInstances } = require('../../util/db');

module.exports = {
  create: (user) => ({ actors }) => actors.createExtended(user, 'users'),

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

  getAll: () => ({ User, users }) =>
    users._get().then(rowsToInstances(User)),

  getOneWhere: (condition) => ({ User, users }) =>
    users._get(condition).then(maybeRowToInstance(User)),

  _get: (condition = []) => ({ User, db }) =>
    db.select('*').from('users').where(condition)
      .orderBy('email', 'asc')
      .join('actors', 'users.actorId', 'actors.id')
      .where({ 'actors.deletedAt': null })
      .then((users) => users.map(User.fromApi)) // TODO: naming; see User.fromApi def.
};

