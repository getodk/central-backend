// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { inspect } = require('util');
const { merge, identity } = require('ramda');
const { reject } = require('../util/promise');
const Problem = require('../util/problem');
const Option = require('../util/option');


////////////////////////////////////////////////////////////////////////////////
// QUERY FORMULATION

// fieldsForJoin and joinRowToInstance together enable fields to be extracted from
// a joined tuple in a principled manner. this function generates explicit mappings
// for every joined table to select.
//
// it takes an argument of the following structure:
// { foo: InstanceClass, bar: InstanceClass, … }
//
// alternatively, one or more definitions may be given as follows:
// { baz: { of: InstanceClass, table: 'table_name' } }
// if some other (eg joined virtual/aliased) table is expected as the source.
//
// from each Instance, .table and .fields.all and .fields.joined are read.
// .fields.all are assumed to exist within the actual database table referenced.
// .fields.joined are assumed to be synthesized and then assigned the given binding
// name with some `AS xyz` phrase within the query.
const fieldsForJoin = (map) => {
  const result = {};
  for (const prefix of Object.keys(map)) {
    // TODO/refactor: somewhat brittle duck typing.
    const Instance = (map[prefix].of != null) ? map[prefix].of : map[prefix];
    const table = map[prefix].table || Instance.table;

    for (const field of Instance.fields.all)
      result[`${prefix}!${field}`] = `${table}.${field}`;

    if (Instance.fields.joined != null)
      for (const field of Instance.fields.joined)
        result[`${prefix}!${field}`] = field;
  }
  return result;
};

// this function essentially reverses the above transformation after the query has
// been performed, separating out the explicit names into each instance and
// instantiating them in the appropriate structure.
//
// it takes two arguments; the second is an object with the same keys passed to
// fieldsForJoin, but with values of the Instance class instead. the first is
// the key name of the instance in the second object that should be top-level,
// containing all the other instances. provide Option[Instance] if the instance
// should be Optionable; the resulting value will also be of Option[Instance].
const joinRowToInstance = (primary, map) => (row) => {
  // first, set up databags and extract fields to nested structure.
  const data = {};
  for (const key of Object.keys(map)) data[key] = {};
  for (const key of Object.keys(row)) {
    const [ prefix, field ] = key.split('!');
    data[prefix][field] = row[key];
  }
  // now walk the classes and instantiate.
  for (const key of Object.keys(map)) {
    if (key !== primary) {
      if (map[key] instanceof Option) { // TODO: not a huge fan of instanceof
        if ((Object.keys(data[key]).length === 0) ||
          (Object.keys(data[key]).every((subkey) => data[key][subkey] == null)))
          data[primary][key] = Option.none();
        else
          data[primary][key] = Option.of(new (map[key].get())(data[key]));
      } else {
        data[primary][key] = new (map[key])(data[key]);
      }
    }
  }
  return new (map[primary])(data[primary]);
};


////////////////////////////////////////////////////////////////////////////////
// QUERY OPTIONS
// a standard mechanism for describing and applying query options. right now,
// we have standardized:
// * extended: Bool (defaults to false)
// * offset: Int (defaults to null)
// * limit: Int (defaults to null)
//
// these are not automatically applied by the middleware but can be attached in
// code manually:
// * condition: condition object/array (defaults to {})
// * modify: function (defaults to identity)

class QueryOptions {
  constructor(options) {
    Object.assign(this, { extended: false, condition: {}, modify: identity }, options);
  }

  withCondition(condition) {
    return new QueryOptions(merge(this, { condition }));
  }
  withModify(modify) {
    return new QueryOptions(merge(this, { modify }));
  }

  hasPaging() {
    return (this.offset != null) || (this.limit != null);
  }

  static fromODataRequest(params, query) {
    const result = { extended: true };
    if ((params.table === 'Submissions') && (query.$skip != null))
      result.offset = parseInt(query.$skip, 10);
    if ((params.table === 'Submissions') && (query.$top != null))
      result.limit = parseInt(query.$top, 10);

    return new QueryOptions(result);
  }
}
QueryOptions.none = new QueryOptions();
QueryOptions.extended = new QueryOptions({ extended: true });

const applyPagingOptions = (options) => (db) => {
  let chain = db;
  if (options.offset != null) chain = chain.offset(options.offset);
  if (options.limit != null) chain = chain.limit(options.limit);
  return chain;
};


////////////////////////////////////////////////////////////////////////////////
// QUERY RESULT INTERPRETATION

// Assumes a row will be returned for sure; instantiates and returns.
const rowToInstance = (Klass) => (rows) => new Klass(rows[0]);

// Guards against nothing being returned; gives an Option[Klass].
const maybeRowToInstance = (Klass) => (rows) =>
  Option.of(rows[0]).map((x) => new Klass(x));

// Simply maps over an array of result rows and instantiates the given Klass
// with that data.
const rowsToInstances = (Klass) => (rows) => {
  const result = [];
  for (let i = 0; i < rows.length; i += 1)
    result.push(new Klass(rows[i]));
  return result;
};

const maybeFirst = ([ x ]) => Option.of(x);

// TODO: should perhaps reject if unsuccessful.
const wasUpdateSuccessful = (result) => result > 0;

// Given the way postgres/knex return rowcount information, extract just the count as an int.
const resultCount = (result) => Number(result[0].count);


////////////////////////////////////////////////////////////////////////////////
// ERROR HANDLING

// deals with postgres returning eg '"xmlFormId", version' error text.
const dequote = (text) => ((text.startsWith('"') && text.endsWith('"')) ? text.slice(1, -1) : text);
const splitPostgresTuple = (text) => text.split(/,\s*/g);

// Generic database failure handler; attempts to interpret DB exceptions.
// if it recognizes the problem, it translates it into a predictable
// error format. either way, it returns a Problem that can be handled
// downstream.
const postgresErrorToProblem = (error) => {
  // if this error isn't actually an Error just reject it anew; it didn't come
  // from Postgres (it probably came from unit tests).
  if ((error == null) || (error.message == null) || (error.stack == null))
    return reject(error);

  // if this error has already been handled, just pass it on through. We might get
  // called multiple times because of how queryPromise chains are set up.
  if (error.isProblem === true)
    return reject(error);

  if (error.code === '23502') { // not_null_violation
    return reject(Problem.user.missingParameter({ field: error.column }));
  } else if (error.code === '23505') { // unique_violation
    const match = /^Key \(([^)]+)\)=\(([^)]+)\) already exists.$/.exec(error.detail);
    if (match != null) {
      const [ , rawFields, rawValues ] = match;
      return reject(Problem.user.uniquenessViolation({
        fields: splitPostgresTuple(rawFields).map(dequote),
        values: splitPostgresTuple(rawValues),
        table: error.table
      }));
    }
  } else if (error.code === '42703') { // undefined_column
    const match = /column "([^"]+)" of relation ".*" does not exist/.exec(error.message);
    if (match != null) {
      const [ , field ] = match;
      return reject(Problem.user.unexpectedAttribute({ field }));
    }
  } else if (error.code === '22P02') {
    const match = /invalid input syntax for ([\w ]+): "([^"]+)"/.exec(error.message);
    if (match != null) {
      const [ , expected, field ] = match;
      return reject(Problem.user.invalidDataTypeOfParameter({ value: field, expected }));
    }
  } else if (error.code === 'P0001') { // raise_exception
    const match = /ODK01:(.+)$/.exec(error.message);
    if (match != null) {
      const [ , email ] = match;
      return reject(Problem.user.uniquenessViolation({
        fields: [ 'email', 'deleted' ],
        values: [ email, 'false' ],
        table: 'users'
      }));
    }
  }

  debugger; // automatically trip the debugger if it's attached.
  process.stderr.write(inspect(error));
  return reject(Problem.internal.unknown({ error }));
};

// Squares away some boilerplate for translating problems into other ones in cases
// where the immediate translation of the database error is cryptic.
const translateProblem = (predicate, result) => (problem) =>
  reject((predicate(problem) === true) ? result(problem) : problem);


module.exports = {
  fieldsForJoin, joinRowToInstance,
  QueryOptions, applyPagingOptions,
  rowToInstance, maybeRowToInstance, rowsToInstances, maybeFirst, wasUpdateSuccessful, resultCount,
  postgresErrorToProblem, translateProblem
};

