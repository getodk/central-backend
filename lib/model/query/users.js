const { wasUpdateSuccessful, fieldsForJoin, joinRowToInstance } = require('../../util/db');
const Option = require('../../reused/option');

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

  getAll: () => ({ users }) => users._get(),

  getOneWhere: (condition) => ({ users }) =>
    users._get(condition).then(([ first ]) => Option.of(first)),

  _get: (condition = []) => ({ Actor, User, db }) =>
    db.select(fieldsForJoin({
      actor: { table: 'actors', fields: Actor.fields() },
      user: { table: 'users', fields: User.fields() }
    }))
      .from('users')
      .where(condition)
      .orderBy('email', 'asc')
      .join('actors', 'users.actorId', 'actors.id')
      .where({ 'actors.deletedAt': null })
      .then((rows) => rows.map(joinRowToInstance('user', { actor: Actor, user: User })))
};

