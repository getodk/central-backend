// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Option = require('../../util/option');
const { QueryOptions, withJoin, maybeFirst } = require('../../util/db');

module.exports = {
  create: (publicLink) => ({ actors }) =>
    actors.createExtended(publicLink, 'public_links')
      .then((fk) => fk.createSession() // eventually this might not happen automatically (eg scheduled links)
        .then((session) => fk.with({ session: Option.of(session) }))),

  getAllForForm: (form, options) => ({ publicLinks }) =>
    publicLinks._get(options.withCondition({ formId: form.id })),

  getByActorIdForForm: (actorId, form, options = QueryOptions.none) => ({ publicLinks }) =>
    publicLinks._get(options.withCondition({ 'actors.id': actorId, formId: form.id }))
      .then(maybeFirst),

  // joins against the actors and sessions table to return guaranteed base
  // information about those relationships that are always present.
  //
  // TODO: using modify in this way is less than elegant.
  _get: (options = QueryOptions.none) => ({ db, PublicLink, Actor, Session }) => ((options.extended === false)
    ? withJoin('publicLink', { publicLink: PublicLink, actor: Actor, session: Option.of(Session) }, (fields, unjoin) =>
      db.select(fields)
        .from('public_links')
        .where(options.condition)
        .join('actors', 'public_links.actorId', 'actors.id')
        .leftOuterJoin('sessions', 'public_links.actorId', 'sessions.actorId')
        .where({ 'actors.deletedAt': null })
        .orderByRaw('(sessions.token is not null) desc')
        .orderBy('actors.createdAt', 'desc')
        .then((rows) => rows.map(unjoin)))

    : withJoin('publicLink', {
      publicLink: PublicLink.Extended,
      actor: Actor,
      createdBy: { Instance: Actor, table: 'created_by' },
      session: Option.of(Session)
    }, (fields, unjoin) =>
      db.select(fields)
        .from('public_links')
        .where(options.condition)
        .join('actors', 'public_links.actorId', 'actors.id')
        .join('actors as created_by', 'public_links.createdBy', 'created_by.id')
        .leftOuterJoin('sessions', 'public_links.actorId', 'sessions.actorId')
        .where({ 'actors.deletedAt': null })
        .orderByRaw('(sessions.token is not null) desc')
        .orderBy('actors.createdAt', 'desc')
        .then((rows) => rows.map(unjoin))))
};

