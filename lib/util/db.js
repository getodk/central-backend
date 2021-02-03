// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { inspect } = require('util');
const { merge, pick, always } = require('ramda');
const { sql } = require('slonik');
const { raw } = require('slonik-sql-tag-raw');
const { reject } = require('../util/promise');
const Problem = require('../util/problem');
const Option = require('../util/option');
const { PartialPipe, mapStream } = require('../util/stream');
const { construct } = require('../util/util');


////////////////////////////////////////////////////////////////////////////////
// SLONIK UTIL

// join/unjoin util

const maybeConstruct = (Ctr) => (x) => {
  if (x == null) return Option.none();
  for (const k of Object.keys(x)) if (x[k] != null) return Option.of(Ctr(x));
  return Option.none();
};

const unjoiner = (...frames) => {
  const fields = [];
  const unmap = {};
  const unprefix = {};
  const constructors = {};

  for (const MaybeInstance of frames) {
    const isOption = MaybeInstance instanceof Option;
    const Instance = isOption ? MaybeInstance.get() : MaybeInstance;
    for (const field of Instance.fields) {
      const sqlname = (Instance.from == null) ? field : `${Instance.from}!${field}`;
      fields.push(`${Instance.from}."${field}" as "${sqlname}"`);
      unmap[sqlname] = Instance.to;
      unprefix[sqlname] = field;
      constructors[Instance.to] = isOption ? maybeConstruct(Instance) : construct(Instance);
    }
  }

  const unjoin = (row) => {
    const bag = {};

    // pull out all the properties into individual sorted objects.
    for (const field of Object.keys(row)) {
      if (bag[unmap[field]] == null) bag[unmap[field]] = {};
      bag[unmap[field]][unprefix[field]] = row[field];
    }

    // pull the primary out and inflate all extensions.
    const primary = bag[frames[0].to];
    delete bag[frames[0].to];
    for (const k of Object.keys(bag)) bag[k] = constructors[k](bag[k]);
    return new frames[0](primary, bag);
  };

  unjoin.fields = raw(fields.join(','));
  return unjoin;
};

const nothing = sql``;
const extender = (...standard) => (...extended) => (sqlFunc) => {
  const stdUnjoiner = unjoiner(...standard);
  const extUnjoiner = unjoiner(...standard, ...extended);

  return (exec, options, x, y, z) => {
    const _unjoiner = (options.extended === true) ? extUnjoiner : stdUnjoiner;
    const extend = (options.extended === true) ? null : nothing;
    return exec(sqlFunc(_unjoiner.fields, extend, options, x, y, z)).then(exec.map(_unjoiner));
  };
};

////////////////////////////////////////
// common query util

// generic insert utility
const _assign = (obj) => (k) => {
  if (k === 'createdAt') return sql`now()`;
  const v = obj[k];
  return (v instanceof Buffer) ? sql.binary(v) :
    (v instanceof Date) ? raw(v) :
    (v === undefined) ? null : // eslint-disable-line indent
    v; // eslint-disable-line indent
};
const _insert = (table, fieldlist, keys, data) => sql`
insert into ${raw(table)} (${fieldlist})
values (${sql.join(keys.map(_assign(data)), sql`,`)})
returning *`;
const insert = (obj) => {
  const keys = Object.keys(obj);
  if (obj.constructor.hasCreatedAt && (obj.createdAt == null)) keys.push('createdAt');
  const fieldlist = sql.join(keys.map((k) => sql.identifier([ k ])), sql`,`);
  return _insert(obj.constructor.table, fieldlist, keys, obj);
};
const insertAll = (obj) =>
  _insert(obj.constructor.table, obj.constructor.fieldlist, obj.constructor.fields, obj);

const insertMany = (objs) => {
  if (objs.length === 0) return sql`select true`;
  const Type = objs[0].constructor;
  return sql`
insert into ${raw(Type.table)} (${Type.fieldlist})
values ${sql.join(
    objs.map((obj) => sql`(${sql.join(Type.fields.map(_assign(obj)), sql`,`)})`),
    sql`,`
  )}`;
};

// generic update utility
const _update = (Type, keys, data, wv, wk) => sql`
update ${raw(Type.table)}
set ${sql.join(keys.map((k) => sql`${sql.identifier([ k ])}=${data[k]}`), sql`,`)}
${Type.hasUpdatedAt ? sql`, "updatedAt"=now()` : nothing}
where ${sql.identifier(wk)}=${wv}
returning *`;
const updater = (obj, whereValue, whereKey = 'id') =>
  _update(obj.constructor, Object.keys(obj), obj, whereValue, whereKey);
const updateAll = (obj, whereValue, whereKey = 'id') =>
  _update(obj.constructor, obj.constructor.fields, obj, whereValue, whereKey);

// generic del utilities
const del = (obj) => ({ run }) =>
  run(sql`delete from ${raw(obj.constructor.table)} where id=${obj.id}`);
const markDeleted = (obj) => ({ run }) =>
  run(sql`update ${raw(obj.constructor.table)} set "deletedAt"=now() where id=${obj.id}`);


////////////////////////////////////////
// query fragment util

const equals = (obj) => {
  const keys = Object.keys(obj);
  if (keys.length === 0) return sql`true`;

  const parts = [];
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const v = obj[k];
    if (v == null) parts.push(sql(`${k} is null`));
    else parts.push(sql`${sql.identifier([ k ])}=${obj[k]}`);
  }
  return sql.join(parts, sql` and `);
};

const page = (options) => {
  const parts = new Array(2);
  if (options.offset != null) parts.push(sql`offset ${options.offset}`);
  if (options.limit != null) parts.push(sql`limit ${options.limit}`);
  return parts.length ? sql.join(parts, sql` `) : nothing;
};

////////////////////////////////////////
// query func decorator
//
// these serve three purposes:
// 1 they smooth over slonik's maybe* funcs not using our Option (bc of course
//   why would it) without us polluting slonik nor requiring excessive homework
// 2 they account for the awkward fact that by using slonik's funcs here we end
//   up having a hard time writing generic postprocessing helpers of our own since
//   the result monad comes in so many flavors. so we provide a map func to decode
//   what happened
// 3 relatedly, they allow passing of the query func to such a helper method, as
//   used above in extender
//
// but also, they do seem a bit goofy and if anyone has a cleaner idea please give
// it a try and a pull request.
const queryFuncs = (db, obj) => {
  /* eslint-disable no-param-reassign */
  obj.run = (s) => db.query(s).then(always(true));
  obj.run.map = () => () => true;

  obj.one = (s) => db.one(s);
  obj.one.map = (f) => (x) => f(x);
  obj.maybeOne = (s) => db.maybeOne(s).then(Option.of);
  obj.maybeOne.map = (f) => (x) => x.map(f);
  obj.oneFirst = (s) => db.oneFirst(s);
  obj.oneFirst.map = (f) => (x) => f(x);
  obj.maybeOneFirst = (s) => db.maybeOneFirst(s).then(Option.of); // not sure we need this tbh
  obj.maybeOneFirst.map = (f) => (x) => x.map(f);

  obj.all = (s) => db.any(s);
  obj.all.map = (f) => (xs) => {
    // TODO/SL: ughhh i hate this repeated func invoc
    const result = new Array(xs.length);
    for (let i = 0; i < xs.length; i += 1) result[i] = f(xs[i]);
    return result;
  };
  obj.first = (s) => db.anyFirst(s);
  obj.first.map = obj.all.map;

  obj.stream = (s) => db.stream(s);
  obj.stream.map = (f) => (strm) => PartialPipe.of(strm, mapStream(f));
  /* eslint-enable no-param-reassign */
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
    Object.assign(this, { extended: false, condition: {} }, options);
  }

  withCondition(additional) {
    const condition = merge(this.condition, additional);
    return new QueryOptions(merge(this, { condition }));
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
  ifArg(arg, f) {
    if (this.args == null) return nothing;
    if (this.args[arg] == null) return nothing;
    return f(this.args[arg]);
  }

  static fromODataRequest(params, query) {
    const result = { extended: true };
    if ((params.table === 'Submissions') && (query.$skip != null))
      result.offset = parseInt(query.$skip, 10);
    if ((params.table === 'Submissions') && (query.$top != null))
      result.limit = parseInt(query.$top, 10);
    if ((params.table === 'Submissions') && (query.$filter != null))
      result.filter = query.$filter;

    return new QueryOptions(result);
  }

  static fromSubmissionCsvRequest(query) {
    const result = { extended: true };
    if (query.$filter != null)
      result.filter = query.$filter;
    return new QueryOptions(result);
  }

  static condition(condition) { return new QueryOptions({ condition }); }
}
QueryOptions.none = new QueryOptions();
QueryOptions.extended = new QueryOptions({ extended: true });


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
  } else if (error.code === '23503') { // foreign_key_violation
    const match = /Key \(([^)]+)\)=\(([^)]+)\) is not present in table "([^"]+)"./.exec(error.detail);
    if (match != null) {
      const [ , field, value, table ] = match;
      return reject(Problem.user.keyDoesNotExist({ field, value, table }));
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
  } else if (error.code === '25P02') { // transaction aborted; command ignored
    // in this case, it just means a check or constraint has failed and whatever
    // else we tried to do in parallel failed, as expected. we'll log a small error
    // message and proceed on; whatever the original failure was will already have
    // bubbled up to the user.
    process.stderr.write('!! 25P02 >> error: current transaction is aborted, commands ignored until end of transaction block\n');
    return reject();
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

    const match05 = /ODK05:(.+):(.+)$/.exec(error.message);
    if (match05 != null) {
      const [ , path, type ] = match05;
      return reject(Problem.user.fieldTypeConflict({ path, type }));
    }
  } else if (error.code === '22001') {
    const match = /value too long for type character varying\((\d+)\)/.exec(error.message);
    const [ , maxLength ] = match;
    if (match != null) {
      return reject(Problem.user.valueTooLong({ maxLength }));
    }
  }

  debugger; // automatically trip the debugger if it's attached.
  process.stderr.write(inspect(error));
  return reject(error);
};


module.exports = {
  unjoiner, extender, equals, page, queryFuncs,
  insert, insertAll, insertMany, updater, updateAll, del, markDeleted,
  QueryOptions,
  postgresErrorToProblem
};

