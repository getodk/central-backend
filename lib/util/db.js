// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { inspect } = require('util');
const { mergeRight, pick, always, without, remove, indexOf } = require('ramda');
const { sql } = require('slonik');
const { reject } = require('./promise');
const Problem = require('./problem');
const Option = require('./option');
const { PartialPipe, mapStream } = require('./stream');
const { construct, base64ToUtf8, utf8ToBase64 } = require('./util');
const { isTrue, isFalse } = require('./http');

const { Transform } = require('stream');

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
const knexConnection = (config) => {
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
// SLONIK UTIL

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
      const fieldName = field.name ?? field;
      const sqlname = (Instance.from == null) ? fieldName : `${Instance.from}!${fieldName}`;
      const sqlAlias = sql.identifier([sqlname]);
      if (field.selectSql) {
        fields.push(sql`${field.selectSql(Instance.from)} as ${sqlAlias}`);
      } else {
        const fullname = (Instance.from == null) ? sql.identifier([field]) : sql.identifier([Instance.from, field]);
        fields.push(sql`${fullname} as ${sqlAlias}`);
      }
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

  unjoin.fields = sql.join(fields, sql`,`);
  return unjoin;
};

const nothing = sql``;
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

// generic insert utility
const _assign = (obj) => (k) => {
  if (k === 'createdAt') return sql`clock_timestamp()`;
  const v = obj[k];
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if (v.constructor === Object || Object.getPrototypeOf(v) == null) return JSON.stringify(v);
  }
  return v;
};
const insert = (obj) => {
  const keys = Object.keys(obj);
  if (obj.constructor.hasCreatedAt) keys.push('createdAt');
  const fieldlist = sql.join(keys.map((k) => sql.identifier([ k ])), sql`,`);
  return sql`
insert into ${sql.identifier([obj.constructor.table])} (${fieldlist})
values (${sql.join(keys.map(_assign(obj)), sql`,`)})
returning *`;
};

// Arguments:
// objs: An array of Frames to be inserted in the database table.
//       Frame should defined fieldTypes for this function to work
//       because Slonik's sql.unnest function has a mandatory columnType argument
const insertMany = (objs) => {
  if (objs.length === 0) return sql`select true`;
  const Type = objs[0].constructor;
  if (!Type.def.fieldTypes) throw Problem.internal.fieldTypesNotDefined(Type.from);

  let columns; let rows; let columnTypes; let
    selectExp;

  // we need to set clock_timestamp if there's createdAt column
  // Slonik doesn't support setting sql identitfier for sql.unnest yet
  if (Type.hasCreatedAt) {
    columns = sql`"createdAt", ${sql.join(without(['createdAt'], Type.insertfields).map(f => sql.identifier([f])), sql`,`)}`;
    rows = objs.map(obj => without(['createdAt'], Type.insertfields).map(_assign(obj)));
    columnTypes = remove(indexOf('createdAt', Type.insertfields), 1, Type.insertFieldTypes);
    selectExp = sql`clock_timestamp(), *`;
  } else {
    columns = Type.insertlist;
    rows = objs.map(obj => Type.insertfields.map(_assign(obj)));
    columnTypes = Type.insertFieldTypes;
    selectExp = sql`*`;
  }

  return sql`
  INSERT INTO ${sql.identifier([Type.table])} (${columns})
  SELECT ${selectExp} FROM ${sql.unnest(rows, columnTypes)} AS t`;
};

// generic update utility
// will set updatedAt if it exists, as long as it is not overwritten in the data
const updater = (obj, data, whereKey = 'id') => {
  const keys = Object.keys(data);
  if (keys.length === 0) return sql`select true`;
  const assigner = _assign(data);
  return sql`
update ${sql.identifier([obj.constructor.table])}
set ${sql.join(keys.map((k) => sql`${sql.identifier([ k ])}=${assigner(k)}`), sql`,`)}
${(obj.constructor.hasUpdatedAt && !keys.includes('updatedAt')) ? sql`,"updatedAt"=clock_timestamp()` : nothing}
where ${sql.identifier([ whereKey ])}=${obj[whereKey]}
returning *`;
};

// generic del utility
const markDeleted = (obj) =>
  sql`update ${sql.identifier([obj.constructor.table])} set "deletedAt"=now() where id=${obj.id}`;

const markUndeleted = (obj) =>
  sql`update ${sql.identifier([obj.constructor.table])} set "deletedAt"=null where id=${obj.id}`;


////////////////////////////////////////
// query fragment util

const sqlEquals = (obj, typeMap = {}) => {
  const keys = Object.keys(obj);
  if (keys.length === 0) return sql`true`;

  const parts = new Array(keys.length);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const v = obj[k];
    const maybeType = typeMap[k];
    if (v instanceof Array && maybeType) {
      parts[i] = sql`${sql.identifier(k.split('.'))} = ANY(${sql.array(v, maybeType)})`;
    } else {
      const typeSpec = maybeType ? sql`::${sql.identifier([maybeType])}` : sql``;
      parts[i] = (v === null) ? sql`${sql.identifier(k.split('.'))} is null`
        : sql`${sql.identifier(k.split('.'))}=${obj[k]}${typeSpec}`;
    }
  }
  return sql.join(parts, sql` and `);
};

const page = (options) => {
  const parts = [];
  if (options.offset != null && !options.skiptoken) parts.push(sql`offset ${options.offset}`);
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
  obj.maybeOneFirst = (s) => db.maybeOneFirst(s).then(Option.of);

  obj.all = (s) => db.any(s);
  obj.all.map = (f) => (xs) => {
    const result = new Array(xs.length);
    for (let i = 0; i < xs.length; i += 1) result[i] = f(xs[i]);
    return result;
  };
  obj.allFirst = (s) => db.anyFirst(s);

  obj.stream = (s) => new Promise((resolve, reject1) => {
    db.stream(s, stream => {
      try {
        const twoMinutes = 2 * 60 * 1000;
        const streamTimeout = setTimeout(() => {
          stream.destroy(new Error('Stream timed out.'));
        }, twoMinutes);

        const wrappedStream = stream.pipe(new Transform({
          objectMode: true,
          transform(data, encoding, cb) {
            streamTimeout.refresh();
            this.push(data);
            cb();
          },
        }));

        stream.on('end', () => {
          // No need to propagate this one:
          //
          // > By default, stream.end() is called on the destination Writable stream when the source Readable stream emits 'end', so that the destination is no longer writable
          // see: https://nodejs.org/api/stream.html#readablepipedestination-options
          //
          // Also, doing so seems to break things.

          clearTimeout(streamTimeout);
        });

        stream.on('error', err => {
          if (!wrappedStream.destroyed) wrappedStream.destroy(err);
          clearTimeout(streamTimeout);
        });

        stream.on('close', () => {
          if (!wrappedStream.destroyed) wrappedStream.destroy();
          clearTimeout(streamTimeout);
        });

        wrappedStream.on('end', () => {
          if (!stream.destroyed) stream.destroy();
          clearTimeout(streamTimeout);
        });

        wrappedStream.on('error', err => {
          if (!stream.destroyed) stream.destroy(err);
          clearTimeout(streamTimeout);
        });

        wrappedStream.on('close', () => {
          if (!stream.destroyed) stream.destroy();
          clearTimeout(streamTimeout);
        });

        resolve(wrappedStream);
      } catch (error) {
        reject1(error);
      }
    }).catch(reject1);
  });
  obj.stream.map = (f) => (strm) => PartialPipe.of(strm, mapStream(({ row }) => f(row)));
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

class QueryOptions {
  constructor(options) {
    Object.assign(this, { extended: false, condition: {} }, options);
  }

  withCondition(additional) {
    const condition = mergeRight(this.condition, additional);
    return new QueryOptions(mergeRight(this, { condition }));
  }

  with(additional) {
    for (const key of Object.keys(additional)) {
      if (key in this) throw new Error(`${key} already exists`);
    }
    return new QueryOptions(mergeRight(this, additional));
  }

  hasPaging() {
    return (this.offset != null) || (this.limit != null) || (this.skiptoken != null);
  }

  allowArgs(...allowed) {
    const args = mergeRight(this.args, pick(allowed, this.argData));
    return new QueryOptions(mergeRight(this, { args }));
  }
  ifArg(arg, f) {
    if (this.args == null) return nothing;
    if (this.args[arg] == null) return nothing;
    return f(this.args[arg]);
  }

  // Parse ODK's proprietary $skiptoken format.  From OData docs:
  //
  // > OData services [i.e. odk-central-backend] may use the reserved system
  // > query option `$skiptoken` when building next links. Its content is
  // > opaque, service-specific, and must only follow the rules for URL query
  // > parts.
  //
  // See: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html
  static parseSkiptoken(token) {
    if (!token.startsWith('01')) throw Problem.user.odataInvalidSkiptoken();

    try {
      const parsed = JSON.parse(base64ToUtf8(token.substr(2)));
      if (typeof parsed !== 'object') throw Problem.user.odataInvalidSkiptoken();
      return parsed;
    } catch (err) {
      throw Problem.user.odataInvalidSkiptoken();
    }
  }

  static getSkiptoken(data) {
    const jsonString = JSON.stringify(data);
    return '01' + utf8ToBase64(jsonString); // 01 is the version number of this scheme
  }

  static fromODataRequest(params, query) {
    const result = { extended: true };
    result.isSubmissionsTable = params.table === 'Submissions';
    if ((params.table === 'Submissions') && (!query.$skiptoken) && (query.$skip != null))
      result.offset = parseInt(query.$skip, 10);
    if ((params.table === 'Submissions') && (query.$top != null))
      result.limit = parseInt(query.$top, 10);
    if (query.$filter != null)
      result.filter = query.$filter;
    if ((params.table === 'Submissions') && (query.$skiptoken != null))
      result.skiptoken = QueryOptions.parseSkiptoken(query.$skiptoken);
    if (query.$orderby != null)
      result.orderby = query.$orderby;

    if (result.orderby && result.skiptoken)
      throw Problem.internal.notImplemented({ feature: 'using $orderby and $skiptoken together' });

    return new QueryOptions(result);
  }

  static fromODataRequestEntities(query) {
    const result = { extended: true };
    if (!query.$skiptoken && query.$skip != null)
      result.offset = parseInt(query.$skip, 10);
    if (query.$top != null)
      result.limit = parseInt(query.$top, 10);
    if (query.$filter != null)
      result.filter = query.$filter;
    if (query.$skiptoken != null)
      result.skiptoken = QueryOptions.parseSkiptoken(query.$skiptoken);
    if (query.$orderby != null)
      result.orderby = query.$orderby;
    if (query.$search != null)
      result.search = query.$search;

    if (result.orderby && result.skiptoken)
      throw Problem.internal.notImplemented({ feature: 'using $orderby and $skiptoken together' });

    return new QueryOptions(result);
  }

  static fromSubmissionCsvRequest(query) {
    const result = { extended: true, isSubmissionsTable: true };
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

  static fromEntityCsvRequest(query) {
    const result = { extended: true };
    if (query.$filter != null)
      result.filter = query.$filter;
    if (query.$search != null)
      result.search = query.$search;
    return new QueryOptions(result);
  }
}
QueryOptions.none = new QueryOptions();
QueryOptions.extended = new QueryOptions({ extended: true });
QueryOptions.forUpdate = new QueryOptions({ forUpdate: true });


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

  if (error.code === '22000' && error.routine === 'range_serialize') {
    return reject(Problem.user.invalidRange());
  }

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
  process.stderr.write(inspect(error) + '\n');
  return reject(error);
};

const sqlInArray = (k, arr) => {
  if (!arr?.length) return sql`FALSE`;
  if (arr.length === 1) return sql`${k} = ${arr[0]}`;
  return sql`${k} IN (${sql.join(arr, sql`,`)})`;
};

module.exports = {
  connectionString, knexConnection,
  unjoiner, extender, sqlEquals, page, queryFuncs,
  insert, insertMany, updater, markDeleted, markUndeleted, sqlInArray,
  QueryOptions,
  postgresErrorToProblem
};

