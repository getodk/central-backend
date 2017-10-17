const { merge } = require('../util');


const BaseModel = (db) =>
class {
  constructor(data, ephemeral = true) {
    this.data = data;
    this._ephemeral = ephemeral;
  }

  serialize() { return this.data; }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE MODIFICATION

  // Creates new data record to database as a new record.
  // Returns a new object representing the created record, with id filled in.
  create() {
    const dataForCreate = merge(this.data, { createdAt: new Date() });
    return db.insert(dataForCreate).into(this._tableName()).returning('*')
      .then((result) => new (this.constructor)(result[0], false));
  }

  // Updates existing data record in database by id.
  // Returns true/false whether succeeded.
  update() {
    const dataForUpdate = merge(this.data, { updatedAt: new Date() });
    return db.update(dataForUpdate).into(this._tableName()).where({ id: this.data.id })
      .then((result) => result.rowCount === 1);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  // Gets one or more entire records from the database by id; instantiates
  // the model object. May be single object or array (if id is not unique).
  static getById(id) {
    return db.select('*').from(this._tableName()).where({ id })
      .then((rows) => rows.map((row) => new this(row, false)));
  }

  // Counts records in table that match the given condition; returns an int.
  static getCount(condition = {}) {
    return db.count('*').from(this._tableName()).where(condition)
      .then((result) => Number(result[0].count));
  }

  // Used by the generic database functions to understand what table to use.
  static _tableName() { return 'base'; }
  _tableName() { return this.constructor._tableName(); }
}

module.exports = BaseModel;

