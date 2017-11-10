
const { maybeRowToInstance, wasUpdateSuccessful } = require('../../util/db');
const Option = require('../../reused/option');

module.exports = {
  create: (user) => ({ actors, simply }) =>
    actors.transacting
      .create(user.actor)
      .then((savedActor) => simply.create('users', user.with({ actor: savedActor }))
        .then((savedUser) => savedUser.with({ actor: savedActor }))),

  getOneWhere: (condition) => ({ users }) =>
    users._get(condition).then((rows) => Option.of(rows[0])),

  _get: (condition) => ({ User, Actor, db }) =>
    db.select('*').from('users').where(condition)
      .join('actors', 'users.actorId', 'actors.id')
      .then((users) => users.map(User.fromApi)) // TODO: naming; see User.fromApi def.
};

