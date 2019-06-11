// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { head } = require('ramda');
const { wasUpdateSuccessful, maybeFirst, withJoin } = require('../../util/db');

module.exports = {
  create: (user) => ({ actors }) => actors.createExtended(user, 'users'),

  update: (user) => ({ users, simply }) =>
    Promise.all([
      users._update(user.actor.id, user.forUpdate()),
      simply.update('actors', user.actor)
    ])
      .then(() => users._get({ actorId: user.actorId }))
      .then(head),

  // returns Boolean success, like _update() itself.
  updatePassword: (user, hash) => ({ users }) =>
    users._update(user.actorId, { password: hash }),

  // necessary since the users table is driven by actorId rather than id.
  // NOTE: does not call forUpdate (takes databag directly), as updating the auth
  // fields are gated on different operations.
  _update: (actorId, data) => ({ db }) =>
    db.update(data).into('users').where({ actorId })
      .then(wasUpdateSuccessful),

  getAll: (options) => ({ users }) =>
    ((options.q != null) ? users._search(options.q) : users._get()),

  getOneWhere: (condition) => ({ users }) =>
    users._get(condition).then(maybeFirst),

  // always joins against the actors table to return embedded Actor information, as
  // we guarantee its presence within the codebase.
  _get: (condition = []) => ({ Actor, User, db }) =>
    withJoin('user', { actor: Actor, user: User }, (fields, unjoin) =>
      db.select(fields)
        .from('users')
        .where(condition)
        .orderBy('email', 'asc')
        .join('actors', 'users.actorId', 'actors.id')
        .where({ 'actors.deletedAt': null })
        .then((rows) => rows.map(unjoin))),

  // TODO: find a way to integrate with _get
  _search: (q) => ({ Actor, User, db }) =>
    withJoin('user', { actor: Actor, user: User }, (fields, unjoin) =>
      db.select(fields)
        .from('users')
        .join('actors', 'users.actorId', 'actors.id')
        .where({ 'actors.deletedAt': null })
        .joinRaw(
          `left join lateral
          greatest(word_similarity("displayName", ?) + similarity("displayName", ?),
          word_similarity(email, ?) + similarity(email, ?)) as score on true`,
          [ q, q, q, q ]
        )
        .where('score', '>', '0.5')
        .orderBy('score', 'desc')
        .then((rows) => rows.map(unjoin)))
};

