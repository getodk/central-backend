// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { merge } = require('ramda');
const Option = require('../../util/option');
const { fieldsForJoin, joinRowToInstance, maybeFirst } = require('../../util/db');

module.exports = {
  create: (fieldKey) => ({ actors }) =>
    actors.createExtended(fieldKey, 'field_keys')
      .then((fk) => fk.createSession()
        .then((session) => fk.with({ session: Option.of(session) }))),

  // for now, we can only create globals.
  getAllGlobals: () => ({ fieldKeys }) => fieldKeys._get(),
  getAllGlobalsExtended: () => ({ fieldKeys }) => fieldKeys._getExtended(),

  getByActorId: (id) => ({ fieldKeys }) =>
    fieldKeys._get({ 'field_keys.actorId': id }).then(maybeFirst),

  // joins against the actors and sessions table to return guaranteed base
  // information about those relationships that are always present.
  _get: (condition = []) => ({ db, FieldKey, Actor, Session }) =>
    db.select(fieldsForJoin({
      fieldKey: { table: 'field_keys', fields: FieldKey.fields() },
      actor: { table: 'actors', fields: Actor.fields() },
      session: { table: 'sessions', fields: Session.fields() }
    }))
      .from('field_keys')
      .where(condition)
      .join('actors', 'field_keys.actorId', 'actors.id')
      .leftOuterJoin('sessions', 'field_keys.actorId', 'sessions.actorId')
      .where({ 'actors.deletedAt': null })
      .orderByRaw('(sessions.token is not null) desc')
      .orderBy('actors.createdAt', 'desc')
      .then((rows) => rows.map(joinRowToInstance('fieldKey', {
        fieldKey: FieldKey,
        actor: Actor,
        session: Option.of(Session)
      }))),

  // joins against everything _get does, but also against the Actor table to
  // expand the createdBy property from an int fk reference to actual data.
  _getExtended: (condition = []) => ({ db, FieldKey, Actor, Session }) =>
    db.select(merge(fieldsForJoin({
      fieldKey: { table: 'field_keys', fields: FieldKey.fields() },
      actor: { table: 'actors', fields: Actor.fields() },
      createdBy: { table: 'created_by', fields: Actor.fields() },
      session: { table: 'sessions', fields: Session.fields() }
    }), { 'fieldKey!lastUsed': 'lastUsed' }))
      .from('field_keys')
      .where(condition)
      .join('actors', 'field_keys.actorId', 'actors.id')
      .join('actors as created_by', 'field_keys.createdBy', 'created_by.id')
      .leftOuterJoin('sessions', 'field_keys.actorId', 'sessions.actorId')
      .leftOuterJoin(
        db.select(db.raw('"actorId", max("loggedAt") as "lastUsed"'))
          .from('audits')
          .where({ action: 'createSubmission' })
          .groupBy('actorId')
          .as('last_usage'),
        'field_keys.actorId', 'last_usage.actorId'
      )
      .where({ 'actors.deletedAt': null })
      .orderByRaw('(sessions.token is not null) desc')
      .orderBy('actors.createdAt', 'desc')
      .then((rows) => rows.map(joinRowToInstance('fieldKey', {
        fieldKey: FieldKey,
        actor: Actor,
        createdBy: Actor,
        session: Option.of(Session)
      })))
};

