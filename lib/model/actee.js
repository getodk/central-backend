const uuid = require('uuid/v4');

const { Subclass } = require('../util/util');
const { withTransaction } = require('../util/db');
const Base = require('./base');


const Actee = Subclass(Base, (superclass, { db }) => class extends superclass {
  get id() { return this.data.id; }

  // named differently from #create since this is a convenience static method.
  // creates a new acteeId of a given species and returns just that id.
  static provision(species, trxn) {
    const id = uuid();
    return db.insert({ id, species }).into(this._tableName())
      .modify(withTransaction(trxn))
      .then((_) => id)
  }

  static _tableName() { return 'actees'; }
});

module.exports = Actee;

