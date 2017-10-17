const knex = require('knex');

const JubilantError = require('../jubilant-error');
const { merge } = require('../util');


class BaseModel {
  constructor(data = {}) {
    this._data = Object.assign({}, data);
    this._ephemeral = true;
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

  // Converts a Knex error to a JubilantError.
  static error(dbError) {
    if (dbError.code === '23505')
      return JubilantError.duplicateRecord('A record with the given unique identifier already exists.');
    return JubilantError.unknownDbError('An unknown database error occurred.');
  }

  toJSON() { return this.data; }

  ////////////////////////////////////////////////////////////////////////////////
  // TABLE METADATA

  // Used by the generic database functions to understand what table to use.
  static tableName() { return 'base'; }

  ////////////////////////////////////////////////////////////////////////////////
  // ATTRIBUTE VALUES

  // Returns a shallow copy of the model object's attribute values. (We may want
  // to update this method to return a deep copy if we end up adding an array or
  // JSON column to the database.)
  get data() { return Object.assign({}, this._data); }

  // Merges the model object's data with the specified data, returning a new
  // model object with the same persistence state.
  merge(data) {
    const obj = (this.constructor)(merge(this._data, data));
    obj._ephemeral = this.ephemeral;
    return obj;
  }

  ////////////////////////////////////////////////////////////////////////////////
  // PERSISTENCE

  // A model object is marked as either ephemeral (not yet saved to the
  // database) or persisted. A model object returned by the constructor is
  // marked as ephemeral. Once it is saved, it is marked as persisted. Model
  // objects returned through model query methods are also marked as persisted.

  get ephemeral() { return this._ephemeral; }

  get persisted() { return !this._ephemeral; }

  _markPersisted() {
    this._ephemeral = false;
    return this;
  }

  /* save() inserts a new row into the database (if the model object is
  ephemeral) or updates an existing row (if the object is persisted), returning
  a promise. If the operation is successful, the promise resolves to a new model
  object. To catch a database exception, call catch() on the promise: the
  exception is guaranteed to be a JubilantError. */
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
      .catch(e => { throw this.error(e); })
      .then(rows => new this(rows[0])._markPersisted());
  }

  static _update(data) {
    const dataForUpdate = merge(data, { updatedAt: new Date() });
    return this
      .db()
      .update(dataForUpdate)
      .table(this.tableName())
      .where({ id: data.id })
      .returning('*')
      .catch(e => { throw this.error(e); })
      .then(rows => new this(rows[0])._markPersisted());
  }

  ////////////////////////////////////////////////////////////////////////////////
  // DATABASE QUERYING

  /*
  Each model class may include its own static methods to query the underlying
  table.

  Use query() to add a model query method to a model class. This allows model
  query methods to be chained after one another and combined with Knex query
  builder methods. For example:

    > class Person extends BaseModel {
        get name() { return this._data.name; }
        get age() { return this._data.age; }
        get nationality() { return this._data.nationality; }
      }

    > Person.
        query('northAmerican', function() {
          this.whereIn('people.nationality', ['US', 'CA', 'MX']);
        }).
        query('adults', function() {
          this.where('people.age', '>=', 18);
        });

    > Person.all().northAmerican().adults().orderBy('id').toString();
    'select * from "people" where "people"."nationality" in (\'US\', \'CA\', \'MX\') and "people"."age" <= 18 order by "id" asc'

  all() returns a ModelQueryBuilder, which has all the methods of a Knex query
  builder, as well as the model class's model query methods. In the callback
  specified to query(), `this` is bound to a ModelQueryBuilder object, so
  within the callback, you are free to use both Knex query builder methods and
  other model query methods:

    > Person.query('orderedAdults', function() {
        this.adults().orderBy('age');
      });

    > Person.all().orderedAdults().toString();
    'select * from "people" where "people"."age" <= 18 order by "id" asc'

  Because `this` is bound when the callback is invoked, it is important that the
  callback not be an arrow function. Note that the example callbacks do not
  return a value: model query methods always return the ModelQueryBuilder.

  query() also adds a static method to the model class for each model query
  method:

    // You can access model query methods through all():
    Person.all().adults();

    // Equivalently, you can also leave out all():
    Person.adults();

  Model subclasses inherit their superclasses' model query methods.

  For more details, see ModelQueryBuilder.
  */

  // Returns a ModelQueryBuilder object that includes the model class's model
  // query methods.
  static all() {
    return new this._queryBuilder(this);
  }

  // Adds a model query method to the model class.
  static query(name, callback) {
    if (!this.hasOwnProperty('_queryBuilder')) {
      // Subclass this._queryBuilder so that we can add a method to it without
      // affecting superclasses of the model class.
      this._queryBuilder = class extends this._queryBuilder {};
    }
    this._queryBuilder.prototype[name] = this._modelQueryMethod(callback);
    this[name] = function(...args) {
      return this.all()[name](...args);
    };
    return this;
  }

  // Converts a callback to a model query method.
  static _modelQueryMethod(callback) {
    return function(...args) {
      callback.apply(this, args);
      /* The function we are in is only ever called as a prototype method on
      ModelQueryBuilder, so here, `this` is bound to a ModelQueryBuilder object.
      Returning `this` makes it easy to chain model query methods. Note that
      this also means that the return value of `callback` is ignored. This
      approach works because Knex query builder objects are mutable: `callback`
      operates through side effects on the query builder object. (Perhaps it
      would be better if Knex query builders were immutable, but this seems like
      the best approach given that they are not. */
      return this;
    };
  }
}



////////////////////////////////////////////////////////////////////////////////
// ModelQueryBuilder

/*
A ModelQueryBuilder decorates a Knex query builder object: it has methods for
each method on the Knex query builder. (It does not decorate static methods or
properties of the Knex query builder that are not methods.) Like a Knex query
builder, a ModelQueryBuilder allows you to build a SQL query through method
chains. Once the query is built, you can execute it or do something else with
it.

A ModelQueryBuilder differs from a Knex query builder in two ways.

First, while Knex queries return plain objects, a ModelQueryBuilder is
associated with a specific object, and ModelQueryBuilder queries can return
persisted model objects. This significantly reduces boilerplate. To execute a
query, use loadRows(), loadRow(), or loadRowElseError(). If a query results in
an error, these methods will also throw a JubilantError rather than a Knex
error. This is convenient for promise chains in controllers.

A ModelQueryBuilder differs from a Knex query builder in a second way.

Each model class has one or more static query methods. For example,
Submission.forFormId() can be used to fetch submissions with a given formId, and
Submission.forInstanceId() can be used to fetch submissions with a given
instanceId. You may wish to chain these methods or to combine them with Knex
query builder methods, something like:

  Submission.forFormId(...).forInstanceId(...).where(...).orderBy(...)

ModelQueryBuilder allows you to do that. The ModelQueryBuilder returned by
BaseModel.all() includes the model class's model query methods (as prototype,
not static, methods). Model query methods simply return the ModelQueryBuilder,
so they may be chained after one another or combined with the methods of
ModelQueryBuilder that forward to the Knex query builder.
*/
class ModelQueryBuilder {
  // This constructor is rarely invoked directly. ModelQueryBuilder objects are
  // created in the BaseModel.all() factory method, which calls this
  // constructor.
  constructor(model) {
    this._model = model;
    this._builder = model.db().queryBuilder().select().from(model.tableName());
  }

  // loadRows() executes the Knex query, returning a promise that maps rows to
  // an array of persisted model objects. If the query results in an error, the
  // promise is rejected with a JubilantError, not a Knex error.
  loadRows() {
    return this
      ._builder
      .catch(e => { throw this._model.error(e); })
      .then(rows => rows.map(row => new (this._model)(row)._markPersisted()));
  }

  // loadRow() executes the Knex query and returns a promise. It fetches a
  // single row and converts it to a persisted model object, returning null if
  // the query returns no rows. If the query results in an error, the promise is
  // rejected with a JubilantError, not a Knex error.
  loadRow() {
    return this
      ._builder
      .first()
      .catch(e => { throw this._model.error(e); })
      .then(row => {
        if (row == null) return null;
        return new (this._model)(row)._markPersisted();
      });
  }

  /* loadRowElseError() executes the Knex query and returns a promise. It
  fetches a single row and converts it to a persisted model object, rejecting
  the promise with an error if the query returns no rows. If the query results
  in an error, the promise is rejected with a JubilantError, not a Knex error.
  loadRowElseError() is very similar to loadRow(): the only difference is how
  they respond when the query returns no rows. */
  loadRowElseError(errorMessage = 'Record not found.') {
    return this
      .loadRow()
      .then(obj => {
        if (obj == null) throw JubilantError.recordNotFound(errorMessage);
        return obj;
      });
  }
}

(function addKnexQueryBuilderMethods() {
  const knexBuilder = knex({ client: 'pg' }).queryBuilder();
  for (const prop in knexBuilder) {
    if (typeof knexBuilder[prop] === 'function' &&
      !ModelQueryBuilder.prototype.hasOwnProperty(prop)) {
      ModelQueryBuilder.prototype[prop] = function(...args) {
        const result = this._builder[prop](...args);
        // If the Knex query builder method simply returns the builder, return
        // the ModelQueryBuilder instead so that the ModelQueryBuilder method
        // can be chained.
        return result === this._builder ? this : result;
      };
    }
  }
}());

BaseModel._queryBuilder = ModelQueryBuilder;



////////////////////////////////////////////////////////////////////////////////
// EXPORTS

module.exports = BaseModel;
