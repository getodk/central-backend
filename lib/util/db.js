// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Readable } = require('stream');
const { inspect } = require('util');
const { merge, pick, always, reduce } = require('ramda');
const sql = require('postgres')();
const { reject } = require('./promise');
const Problem = require('./problem');
const Option = require('./option');
const { PartialPipe, mapStream } = require('./stream');
const { construct, objIsEmpty } = require('./util');
const { isTrue, isFalse } = require('./http');


////////////////////////////////////////////////////////////////////////////////
// DATABASE CONFIG

const validateConfig = (config) => {
  const { host, port, database, user, password, ssl, maximumPoolSize, ...unsupported } = config;

  if (ssl != null && ssl !== true)
    return Problem.internal.invalidDatabaseConfig({ reason: 'If ssl is specified, its value can only be true.' });

  const unsupportedKeys = Object.keys(unsupported);
  if (unsupportedKeys.length !== 0)
    return Problem.internal.invalidDatabaseConfig({
      reason: `'${unsupportedKeys[0]}' is unknown or is not supported.`
    });

  return null;
};

// Returns a connection string that will be passed to Slonik.
const connectionString = (config) => {
  const problem = validateConfig(config);
  if (problem != null) throw problem;
  const encodedPassword = encodeURIComponent(config.password);
  const hostWithPort = config.port == null ? config.host : `${config.host}:${config.port}`;
  const queryString = config.ssl == null ? '' : `?ssl=${config.ssl}`;
  return `postgres://${config.user}:${encodedPassword}@${hostWithPort}/${config.database}${queryString}`;
};

// Returns an object that Knex will use to connect to the database.
const connectionObject = (config) => {
  const problem = validateConfig(config);
  if (problem != null) throw problem;
  // We ignore maximumPoolSize when using Knex.
  const { maximumPoolSize, ...knexConfig } = config;
  if (knexConfig.ssl === true) {
    // Slonik seems to specify `false` for `rejectUnauthorized` whenever SSL is
    // specified:
    // https://github.com/gajus/slonik/issues/159#issuecomment-891089466. We do
    // the same here so that Knex will connect to the database in the same way
    // as Slonik.
    knexConfig.ssl = { rejectUnauthorized: false };
  }
  return knexConfig;
};


////////////////////////////////////////////////////////////////////////////////
// STREAMING DB ACCESS
// for whatever reason porsagres ships without any native node stream support.
// here we use pg-query-stream as guidance to derive streams from the cursor interface.
// the way the porsagres async iterator works as of time of writing, each window
// is only fetched when next() is called.
//
// this guide here is handy:
// https://nodejs.org/en/docs/guides/backpressuring-in-streams/
class QueryStream extends Readable {
  constructor(q) {
    // pg-query-stream uses default 100 hwm, just bake it here and below until we want otherwise.
    super({ objectMode: true, autoDestroy: true, highWaterMark: 100 });
    this.q = q;
    this.buffer = [];
    this.requested = 0;
  }
  // https://nodejs.org/api/stream.html#stream_readable_read_size_1
  _read(size) {
    this.requested = size; // idk if this is "right" but it should be okay + it's simpler for now
    this.qpush(this.buffer);

    // maybe in some other circumstance it should be important to only request further
    // data from the db if the buffer is low, but realistically it should typically be
    // empty by now and even if not one extra buffer is really not the worst.
    if (this.qresult == null)
      this.qresult = this.q.cursor(100, (rows) => {
        this.qpush(rows);
        for (let i = 0; i < rows.length; i += 1) this.buffer.push(rows[i]);

        return new Promise((qcontinue, qterminate) => {
          this.qcontinue = qcontinue;
          this.qterminate = qterminate;

          if (this.buffer.length < this.requested) this.qcontinue();
        });
      }).then(
        () => { this.buffer.push(null); this.qpush(this.buffer); },
        (err) => { this.destroy(err); }
      );
    else
      this.qcontinue();
  }
  qpush(source) {
    while ((this.requested > 0) && (source.length > 0) && this.push(source.shift()))
      this.requested -= 1;
  }
  _destroy(err, cb) {
    this.qterminate?.();
    cb(err);
  }
}


////////////////////////////////////////////////////////////////////////////////
// FRAGMENT UTIL

const nothing = sql``;

// join/unjoin util

const maybeConstruct = (Ctr) => (x) => {
  if (x == null) return Option.none();
  for (const k of Object.keys(x)) if (x[k] != null) return Option.of(new Ctr(x));
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
      const fullname = (Instance.from == null) ? `"${field}"` : `${Instance.from}."${field}"`;
      const sqlname = (Instance.from == null) ? field : `${Instance.from}!${field}`;
      fields.push(`${fullname} as "${sqlname}"`);
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
    for (const k of Object.keys(bag)) {
      if (typeof constructors[k] !== 'function') {
        console.log('expected fields:', unmap, unprefix);
        console.error('FAULT received data:', row, constructors, k, Object.keys(bag),  bag);
      }
      bag[k] = constructors[k](bag[k]);
    }
    return new frames[0](primary, bag);
  };

  unjoin.fields = sql.unsafe(fields.join(','));
  return unjoin;
};

const extender = (...standard) => (...extended) => (sqlFunc) => {
  const stdUnjoiner = unjoiner(...standard);
  const extUnjoiner = unjoiner(...standard, ...extended);

  return (exec, options, w, x, y, z) => {
    const _unjoiner = (options.extended === true) ? extUnjoiner : stdUnjoiner;
    const extend = (options.extended === true) ? null : nothing;
    return exec(sqlFunc(_unjoiner.fields, extend, options, w, x, y, z)).then(exec.map(_unjoiner));
  };
};

////////////////////////////////////////
// common query util

const insert = (obj) => {
  const data = obj.constructor.hasCreatedAt ? { createdAt: sql`clock_timestamp()`, ...obj } : obj;
  return sql`insert into ${sql(obj.constructor.table)} ${sql(data)} returning *`;
};

const insertMany = (objs) => {
  if (objs.length === 0) return sql`select true`;
  const Type = objs[0].constructor;
  const data = Type.hasCreatedAt
    ? objs.map((obj) => ({ createdAt: sql`clock_timestamp()`, ...obj }))
    : objs;

  return sql`insert into ${sql(Type.table)} ${sql(data, ...Type.insertfields)}`;
};

// generic update utility
const updater = (obj, data, whereKey = 'id') => {
  if (objIsEmpty(data)) return sql`select true`;
  return sql`
update ${sql(obj.constructor.table)}
set ${sql(data)}
${obj.constructor.hasUpdatedAt ? sql`,"updatedAt"=clock_timestamp()` : nothing}
where ${sql(whereKey)}=${obj[whereKey]}
returning *`;
};

// generic del utility
const markDeleted = (obj) =>
  sql`update ${sql(obj.constructor.table)} set "deletedAt"=now() where id=${obj.id}`;

const markUndeleted = (obj) =>
  sql`update ${sql(obj.constructor.table)} set "deletedAt"=null where id=${obj.id}`;


////////////////////////////////////////
// query fragment util

const joinSqlStr = (xs, separator) =>
  reduce(((m, x) => (m ? sql`${m}${separator}${x}` : x)), undefined, xs);

const equals = (obj) => {
  const keys = Object.keys(obj);
  if (keys.length === 0) return sql`true`;

  const parts = new Array(keys.length);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const v = obj[k];
    parts[i] = (v === null) ? sql`${sql(k)} is null` : sql`${sql(k)}=${obj[k]}`;
  }
  return joinSqlStr(parts, sql` and `);
};

const page = (options) => {
  const parts = [];
  if (options.offset != null) parts.push(sql`offset ${options.offset}`);
  if (options.limit != null) parts.push(sql`limit ${options.limit}`);
  return parts.length ? joinSqlStr(parts, sql` `) : nothing;
};

////////////////////////////////////////
// query func decorator
//
// there used to be a long explanation here talking about how these methods
// line up with slonik's api, and how the .map "methods" we provide here helped
// us deal with how its api sort of forces its users into these result monad shapes
// that make dealing with them generically (eg w the extender or the joiner/unjoiner)
// sort of difficult.
//
// well, we don't use slonik anymore so this is just what our query api looks
// like now. it turns out to be pretty convenient anyway.
const queryFuncs = (db, obj) => {
  /* eslint-disable no-param-reassign */
  obj.run = (s) => db`${s}`.then(always(true));
  obj.run.map = () => () => true;

  obj.q = (s) => db`${s}`;

  obj.one = (s) => db`${s}`.then(([ x ]) => x); // CRCRCR: slonik used to Enforce existence, do we care?
  obj.one.map = (f) => (x) => f(x);
  obj.maybeOne = (s) => db`${s}`.then(([ x ]) => Option.of(x));
  obj.maybeOne.map = (f) => (x) => x.map(f);
  obj.oneFirst = (s) => db`${s}`.then((res) => res[0][res.columns[0].name]);
  obj.oneFirst.map = (f) => (x) => f(x);

  obj.all = (s) => db`${s}`;
  obj.all.map = (f) => (xs) => {
    const result = new Array(xs.length);
    for (let i = 0; i < xs.length; i += 1) result[i] = f(xs[i]);
    return result;
  };

  obj.stream = (s) => new QueryStream(db`${s}`);
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
    if (isFalse(query.groupPaths))
      result.groupPaths = false;
    if (isTrue(query.deletedFields))
      result.deletedFields = true;
    if (isTrue(query.splitSelectMultiples))
      result.splitSelectMultiples = true;
    return new QueryOptions(result);
  }
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
const postgresErrorToProblem = (x) => {
  // may or may not have to unwrap a slonik result error wrapper. :/
  const error = ((x != null) && (x.originalError != null)) ? x.originalError : x;

  // if this error isn't actually an Error just reject it anew; it didn't come
  // from Postgres (it probably came from unit tests).
  if ((error == null) || (error.message == null) || (error.stack == null))
    return reject(error);

  // if this error has already been handled, just pass it on through. We might get
  // called multiple times because of how queryPromise chains are set up.
  if (error.isProblem === true)
    return reject(error);

  if (error.code === '22003') {
    const match = /value "([^"]+)" is out of range for type (\w+)$/.exec(error.message);
    if (match != null) {
      const [ , value, type ] = match;
      return reject(Problem.user.valueOutOfRangeForType({ value, type }));
    }
  } else if (error.code === '23502') { // not_null_violation
    return reject(Problem.user.missingParameter({ field: error.column }));
  } else if (error.code === '23505') { // unique_violation
    const match = /^Key \(([^)]+)\)=\((.+)\) already exists.$/.exec(error.detail);
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
    process.stderr.write('\n!! 25P02 >> error: current transaction is aborted, commands ignored until end of transaction block\n');
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

    const match06 = /ODK06:(.+)$/.exec(error.message);
    if (match06 != null) {
      const [ , instanceId ] = match06;
      return reject(Problem.user.uniquenessViolation({ fields: 'instanceID', values: instanceId }));
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
  process.stderr.write(`\nQUERY\n=====\n${error.query}\n`);
  return reject(error);
};


module.exports = {
  connectionString, connectionObject,
  unjoiner, extender, equals, joinSqlStr, page, queryFuncs,
  insert, insertMany, updater, markDeleted, markUndeleted,
  QueryOptions,
  postgresErrorToProblem
};

