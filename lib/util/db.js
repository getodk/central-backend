// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { inspect } = require('util');
const { merge, identity, pick } = require('ramda');
const { reject } = require('../util/promise');
const Problem = require('../util/problem');
const Option = require('../util/option');


////////////////////////////////////////////////////////////////////////////////
// QUERY FORMULATION

// withJoin enables fields to be extracted from a joined tuple in a principled manner.
// it generates explicit mappings for every joined table to select, and a corresponding
// function that can deserialize a database-returned datagram into a proper Instance
// with the joined data nested within appropriately.
//
// it takes an argument of the following structure:
// { foo: InstanceClass, bar: InstanceClass, … }
//
// alternatively, one or more definitions may be given as follows:
// { baz: { Instance: InstanceClass, table: 'table_name' } }
// if some other (eg joined virtual/aliased) table is expected as the source.
//
// in addition, InstanceClass may be given as Option[InstanceClass] instead, in
// which the propery will as well be given as an Option[InstanceClass] depending
// on whether the join was successful.
//
// internally, from each Instance, .table and .fields.all and .fields.joined are read.
// .fields.all are assumed to exist within the actual database table referenced.
// .fields.joined are assumed to be synthesized and then assigned the given binding
// name with some `AS xyz` phrase within the query.
const withJoin = (primary, map, query) => {
  // first, generate the selection fields object and figure out which constructors
  // go with which tables:
  const fields = {};
  const constructors = {};
  const options = {};
  for (const prefix of Object.keys(map)) {
    // TODO/refactor: somewhat brittle duck typing.
    const maybeInstance = (map[prefix].Instance != null) ? map[prefix].Instance : map[prefix];
    if (maybeInstance instanceof Option) { // TODO: not a huge fan of instanceof
      constructors[prefix] = maybeInstance.get();
      options[prefix] = true;
    } else {
      constructors[prefix] = maybeInstance;
    }

    const Instance = constructors[prefix];
    const table = map[prefix].table || Instance.table;
    for (const field of Instance.fields.all)
      fields[`${prefix}!${field}`] = `${table}.${field}`;

    if (Instance.fields.joined != null)
      for (const field of Instance.fields.joined)
        fields[`${prefix}!${field}`] = field;
  }

  // then, create the function that can unjoin the records back out into
  // instance objects based on those generated fields.
  const unjoin = (row) => {
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
        if (options[key] === true) {
          if ((Object.keys(data[key]).length === 0) ||
            (Object.keys(data[key]).every((subkey) => data[key][subkey] == null)))
            data[primary][key] = Option.none();
          else
            data[primary][key] = Option.of(new (constructors[key])(data[key]));
        } else {
          data[primary][key] = new (constructors[key])(data[key]);
        }
      }
    }
    return new (map[primary])(data[primary]);
  };

  return query(fields, unjoin);
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

  withCondition(additional) {
    const condition = merge(this.condition, additional);
    return new QueryOptions(merge(this, { condition }));
  }
  withModify(modify) {
    return new QueryOptions(merge(this, { modify }));
  }

  hasPaging() {
    return (this.offset != null) || (this.limit != null);
  }

  allowArgs(...allowed) {
    const args = merge(this.args, pick(allowed, this.argData));
    return new QueryOptions(merge(this, { args }));
  }
  withArgs(additional) {
    const args = merge(this.args, additional);
    return new QueryOptions(merge(this, { args }));
  }

  static fromODataRequest(params, query) {
    const result = { extended: true };
    if ((params.table === 'Submissions') && (query.$skip != null))
      result.offset = parseInt(query.$skip, 10);
    if ((params.table === 'Submissions') && (query.$top != null))
      result.limit = parseInt(query.$top, 10);

    return new QueryOptions(result);
  }

  static condition(condition) { return new QueryOptions({ condition }); }
}
QueryOptions.none = new QueryOptions();
QueryOptions.extended = new QueryOptions({ extended: true });

const applyPagingOptions = (options) => (db) => {
  let chain = db;
  if (options.offset != null) chain = chain.offset(options.offset);
  if (options.limit != null) chain = chain.limit(options.limit);
  return chain;
};

const ifArg = (arg, options, f) => (db) =>
  (((options.args != null) && (options.args[arg] != null)) ? f(options.args[arg], db) : db);


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
    const match01 = /ODK01:(.+)$/.exec(error.message);
    if (match01 != null) {
      const [ , email ] = match01;
      return reject(Problem.user.uniquenessViolation({
        fields: [ 'email', 'deleted' ],
        values: [ email, 'false' ],
        table: 'users'
      }));
    }

    // TODO: there is a small chance here that this regex will fail if the user uses
    // the exact 3-char string ':' within their own query but.. this seems unlikely?
    const match02 = /ODK02:(\d+):'(.+)':'(.*)'$/.exec(error.message);
    if (match02 != null) {
      const [ , projectId, xmlFormId, version ] = match02;
      return reject(Problem.user.uniquenessViolation({
        fields: [ 'projectId', 'xmlFormId', 'version' ],
        values: [ projectId, xmlFormId, version ],
        table: 'forms'
      }));
    }

    const match03 = /ODK03:(.+)$/.exec(error.message);
    if (match03 != null) {
      const [ , state ] = match03;
      return reject(Problem.user.unexpectedValue({
        field: 'state',
        value: state,
        reason: 'not a recognized state name'
      }));
    }

    if (/ODK04/.test(error.message) === true)
      return reject(Problem.user.encryptionActivating());

  } else if (error.code === '22001') {
    const match = /value too long for type character varying\((\d+)\)/.exec(error.message);
    const [ , maxLength ] = match;
    if (match != null) {
      return reject(Problem.user.valueTooLong({ maxLength }));
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
  withJoin,
  QueryOptions, applyPagingOptions, ifArg,
  rowToInstance, maybeRowToInstance, rowsToInstances, maybeFirst, wasUpdateSuccessful, resultCount,
  postgresErrorToProblem, translateProblem
};

