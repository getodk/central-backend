const Option = require('../../reused/option');
const { fieldsForJoin, joinRowToInstance } = require('../../util/db');

module.exports = {
  create: (fieldKey) => ({ actors }) =>
    actors.createExtended(fieldKey, 'field_keys')
      .then((fk) => fk.createSession()
        .then((session) => fk.with({ session: Option.of(session) }))),

  // for now, we can only create globals.
  getAllGlobals: () => ({ fieldKeys }) => fieldKeys._get(),

  getByActorId: (id) => ({ fieldKeys }) =>
    fieldKeys._get({ 'field_keys.actorId': id }).then(([ first ]) => Option.of(first)),

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
      })))
};

