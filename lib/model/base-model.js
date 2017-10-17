const { merge } = require('../util');


class BaseModel {
  constructor(data, ephemeral = true) {
    this.data = data;
    this._ephemeral = ephemeral;
  }

  /*
  Gets or sets the Knex db object that BaseModel will use to interact with the
  database. For example:

    // Sets the Knex db object.
    const db = require('./lib/model/database').connect();
    BaseModel.db(db);

    // Returns the Knex db object that has been set.
    BaseModel.db();
  */
  static db(db) {
    if (arguments.length !== 0)
      this._db = db;
    else if (this._db === undefined)
      throw new Error('Knex db object is not set.');
    return this._db;
  }

  serialize() { return this.data; }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE MODIFICATION

  // Creates new data record to database as a new record.
  // Returns a new object representing the created record, with id filled in.
  create() {
    const dataForCreate = merge(this.data, { createdAt: new Date() });
    return this.constructor.db().insert(dataForCreate).into(this._tableName()).returning('*')
      .then((result) => new (this.constructor)(result[0], false));
  }

  // Updates existing data record in database by id.
  // Returns true/false whether succeeded.
  update() {
    const dataForUpdate = merge(this.data, { updatedAt: new Date() });
    return this.constructor.db().update(dataForUpdate).into(this._tableName()).where({ id: this.data.id })
      .then((result) => result.rowCount === 1);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  // Gets one or more entire records from the database by id; instantiates
  // the model object. May be single object or array (if id is not unique).
  static getById(id) {
    return this.db().select('*').from(this._tableName()).where({ id })
      .then((rows) => rows.map((row) => new this(row, false)));
  }

  // Counts records in table that match the given condition; returns an int.
  static getCount(condition = {}) {
    return this.db().count('*').from(this._tableName()).where(condition)
      .then((result) => Number(result[0].count));
  }

  // Used by the generic database functions to understand what table to use.
  static _tableName() { return 'base'; }
  _tableName() { return this.constructor._tableName(); }
}

module.exports = BaseModel;

