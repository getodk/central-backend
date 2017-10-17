const { merge } = require('../util');


class BaseModel {
  constructor(data, ephemeral = true) {
    this._data = Object.assign({}, data);
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
  // ATTRIBUTE VALUES

  // Returns a shallow copy of the model object's attribute values. (We may want
  // to update this method to return a deep copy if we end up adding an array or
  // JSON column to the database.)
  get data() { return Object.assign({}, this._data); }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE MODIFICATION

  /* save() inserts a new row into the database (if the model object is
  ephemeral) or updates an existing row (if the object is persisted), returning
  a promise. If the operation is successful, the promise resolves to a new model
  object. To catch a database exception, call catch() on the promise: the
  exception will be a Knex error. */
  save() {
    return this._ephemeral ?
      this.constructor._create(this._data) :
      this.constructor._update(this._data);
  }

  // _create() and _update() could be prototype methods instead of static, but
  // given how much they use the constructor, it is convenient for them to be
  // static.
  static _create(data) {
    const now = new Date();
    const timestamps = { createdAt: now, updatedAt: now };
    const dataForCreate = merge(data, timestamps);
    return this
      .db()
      .insert(dataForCreate)
      .into(this.tableName())
      .returning('*')
      .then(rows => new this(rows[0], false));
  }

  static _update(data) {
    const dataForUpdate = merge(data, { updatedAt: new Date() });
    return this
      .db()
      .update(dataForUpdate)
      .table(this.tableName())
      .where({ id: data.id })
      .returning('*')
      .then(rows => new this(rows[0], false));
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  // Gets one or more entire records from the database by id; instantiates
  // the model object. May be single object or array (if id is not unique).
  static getById(id) {
    return this.db().select('*').from(this.tableName()).where({ id })
      .then((rows) => rows.map((row) => new this(row, false)));
  }

  // Counts records in table that match the given condition; returns an int.
  static getCount(condition = {}) {
    return this.db().count('*').from(this.tableName()).where(condition)
      .then((result) => Number(result[0].count));
  }

  // Used by the generic database functions to understand what table to use.
  static tableName() { return 'base'; }
}

module.exports = BaseModel;

