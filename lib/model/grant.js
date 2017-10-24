const { ensureArray, Subclass } = require('../util/util');
const { ensureTransaction, rowsToInstances, renameMeDbHandler } = require('../util/db');
const Base = require('./base');


const Grant = Subclass(Base, (superclass, { db, models }) => class extends superclass {

  static allow(actor, verbs, actee, maybeTrxn) {
    const actorId = actor.id;
    const acteeId = (typeof actee === 'string') ? actee : actee.acteeId;

    return ensureTransaction(db, maybeTrxn, (trxn) =>
      Promise.all(ensureArray(verbs).map((verb) =>
        (new models.Grant({ actorId, verb, acteeId })).create()
      )).then(() => true)
    );
  }

  static revoke(actor, verbs, actee, maybeTrxn) {
    //
  }

  static revokeAll(actor, actee, maybeTrxn) {
    //
  }

  static getByTriple(actor, verb, actee) {
    const impliedActors = '"actorId" in (with recursive implied_actors(id) as (select ?::int union all select "parentActorId" as id from implied_actors a, memberships m where a.id = m."childActorId") select id from implied_actors)';

    return this._selectAll()
      .whereRaw(impliedActors, actor.id)
      .where({ verb })
      .whereIn('acteeId', actee.acteeIds())
      .then(rowsToInstances(this))
      .catch(renameMeDbHandler);
  }

  static _tableName() { return 'grants'; }
});

module.exports = Grant;

