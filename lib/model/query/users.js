
const { maybeRowToInstance, wasUpdateSuccessful } = require('../../util/db');
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

  // necessary since the users table is driven by actorId rather than id.
  // NOTE: does not call forUpdate (takes databag directly), as updating the auth
  // fields are gated on different operations.
  _update: (actorId, data) => ({ db }) =>
    db.update(data).into('users').where({ actorId })
      .then(wasUpdateSuccessful),

  getOneWhere: (condition) => ({ users }) =>
    users._get(condition).then((rows) => Option.of(rows[0])),

  _get: (condition) => ({ User, Actor, db }) =>
    db.select('*').from('users').where(condition)
      .join('actors', 'users.actorId', 'actors.id')
      .then((users) => users.map(User.fromApi)) // TODO: naming; see User.fromApi def.
};

