const { merge, without, Subclass } = require('../util/util');
const { ensureTransaction, withTransaction, rowToInstance, renameMeDbHandler } = require('../util/db');
const Base = require('./base');


const User = Subclass(Base, (superclass, { db, models }) => class extends superclass {
  _initialize() {
    // TODO: i'm not sure about this approach for separating this data.
    if (this.data.actor != null) {
      if (this.data.actor.data != null)
        // we have been given a full actor instance.
        this._actor = this.data.actor;
      else
        // we have been given actor data.
        this._actor = new models.Actor(merge({ type: models.Actor.type.user }, this.data.actor));
      delete this.data.actor;
    } else {
      this._actor = new models.Actor({ type: models.Actor.type.user });
    }
  }

  ////////////////////////////////////////////////////////////////////////////////
  // ATTRIBUTES

  get actor() { return this._actor; }
  get displayName() { return this._actor.displayName; }

  // TODO: formalize non-serialized fields mechanism.
  serialize() {
    return without(merge(this.data, { actor: this.actor.serialize() }), 'password', 'mfaSecret', 'actorId');
  }
  with(data) {
    return new (this.constructor)(merge(this.data, { actor: this.actor }, data));
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  // if the actor is not persisted, then creates an actor (which in turn creates
  // an actee), after which a user is created. a transaction is enforced upon
  // the whole chain.
  // otherwise, simply creates the user.
  create(maybeTrxn) {
    if (this.actor.ephemeral === true)
      return ensureTransaction(db, maybeTrxn, (trxn) =>
        this.actor.create(trxn).then((actor) =>
          this.with({ actor }).create(trxn) // TODO NEXT: how to fluently put actor back in here?
        )
      );
    else
      return super.create(maybeTrxn);
  }
  _dataForCreate() { return { actorId: this.actor.id }; }

  static getByEmail(email, trxn) {
    return db.select('*').from(this._tableName()).where({ email })
      .leftJoin('actors', 'users.actorId', 'actors.id')
      .modify(withTransaction(trxn))
      .then(rowToInstance(this));
  }

  // users depend on multiple tables.
  static _tableName() { return 'users'; }
});


module.exports = User;

