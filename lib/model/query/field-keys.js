const { merge } = require('ramda');
const Option = require('../../reused/option');
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
      .orderBy('actors.createdAt', 'desc')
      .then((rows) => rows.map(joinRowToInstance('fieldKey', {
        fieldKey: FieldKey,
        actor: Actor,
        session: Option.of(Session)
      }))),

  _getExtended: (condition = []) => ({ db, FieldKey, Actor, Session }) =>
    db.select(merge({ 'fieldKey!lastUsed': 'lastUsed' }, fieldsForJoin({
      fieldKey: { table: 'field_keys', fields: FieldKey.fields() },
      actor: { table: 'actors', fields: Actor.fields() },
      createdBy: { table: 'created_by', fields: Actor.fields() },
      session: { table: 'sessions', fields: Session.fields() }
    })))
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
      .orderBy('actors.createdAt', 'desc')
      .then((rows) => rows.map(joinRowToInstance('fieldKey', {
        fieldKey: FieldKey,
        actor: Actor,
        createdBy: Actor,
        session: Option.of(Session)
      })))
};

