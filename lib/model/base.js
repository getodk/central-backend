const { merge } = require('../util/util');
const { withTransaction, rowToInstance, wasUpdateSuccessful, resultCount, renameMeDbHandler } = require('../util/db');


const Base = ({ db }) => class {
  constructor(data = {}) {
    this.data = data;
    if (typeof this._initialize === 'function') this._initialize();
  }

  ////////////////////////////////////////////////////////////////////////////////
  // BASIC PROPERTIES

  with(data) { return new (this.constructor)(merge(this.data, data)); }

  serialize() { return this.data; }

  get ephemeral() { return this.data.id == null; }
  get persisted() { return this.data.id != null; }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE MODIFICATION

  // Creates new data record to database as a new record.
  // Takes an optional transaction object.
  // Returns a new object representing the created record, with id filled in.
  create(trxn) {
    const dataForCreate = merge(this.data, this._dataForCreate());
    return db.insert(dataForCreate).into(this._tableName())
      .returning('*')
      .modify(withTransaction(trxn))
      .then(rowToInstance(this.constructor))
      .catch(renameMeDbHandler);
  }

  // TODO: I hate method proliferation/OOP inheritance behavior overides.
  // Is there a better way without polluting the public API? (Yes, higher order
  // functions, but.. something people know how to use)
  _dataForCreate() {
    return { createdAt: new Date() };
  }

  // Updates existing data record in database by id.
  // Returns true/false whether succeeded.
  update(trxn) {
    const dataForUpdate = merge(this.data, { updatedAt: new Date() });
    return db.update(dataForUpdate).into(this._tableName())
      .where({ id: this.data.id })
      .modify(withTransaction(trxn))
      .then(wasUpdateSuccessful)
      .catch(renameMeDbHandler);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  static _selectAll() {
    return db.select('*').from(this._tableName());
  }

  static _count() {
    return db.count('*').from(this._tableName());
  }

  // Gets one or more entire records from the database by id; instantiates
  // the model object. Will always be an array containing result(s).
  //
  // TODO: should we change this to assume a single result, and make
  // another method for multiple? Or simply override in the cases where it
  // is possible?
  static getById(id) {
    return this._selectAll().where({ id }).then(rowsToInstances(this));
  }

  // Counts records in table that match the given condition; returns an int.
  static getCount(condition = {}) {
    return this._count().where(condition).then(resultCount);
  }

  // Used by the generic database functions to understand what table to query.
  static _tableName() { return 'base'; }
  _tableName() { return this.constructor._tableName(); }
};

module.exports = Base;

