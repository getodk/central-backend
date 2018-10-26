// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { wasUpdateSuccessful, maybeFirst, fieldsForJoin, joinRowToInstance } = require('../../util/db');

module.exports = {
  create: (user) => ({ actors }) => actors.createExtended(user, 'users'),

  update: (user) => ({ all, users, simply }) =>
    all.areTrue([
      users._update(user.actor.id, user.forUpdate()),
      simply.update('actors', user.actor)
    ]),

  // returns Boolean success, like _update() itself.
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
    users._get(condition).then(maybeFirst),

  // always joins against the actors table to return embedded Actor information, as
  // we guarantee its presence within the codebase.
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

