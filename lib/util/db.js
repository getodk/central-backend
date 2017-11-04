const { inspect } = require('util');
const { reject } = require('./util');
const Problem = require('../problem');
const Option = require('../reused/option');

////////////////////////////////////////////////////////////////////////////////
// TRANSACTION MANAGEMENT

// If a transaction is given, ensures it is applied against the querychain.
// otherwise, passes the querychain directly through.
//
// Use when indifferent to whether the query is in a transaction.
//
// Example usage: db.select('*').from('table').modify(withTransaction(trxn)).etc
const withTransaction = (trxn) => (db) => ((trxn == null) ? db : db.transacting(trxn));

// If a transaction is given, passes that transaction through to the callback.
// If none is given, initiates a new transaction and hands it through. Built to
// mimic the signature of knex's own db.transaction call.
//
// Use when a transaction is required by this query, and should be applied down
// through nested calls.
//
// Example usage:
// ensureTransaction(db, maybeTrxn, (trxn) => {
//   db.select('*').from('table').transacting(trxn).etc
// });
const ensureTransaction = (db, trxn, callback) => ((trxn == null) ? db.transaction(callback) : callback(trxn));


////////////////////////////////////////////////////////////////////////////////
// QUERY RESULT INTERPRETATION

// Assumes a row will be returned for sure; instantiates and returns.
const rowToInstance = (Klass) => (rows) => new Klass(rows[0]);

// Guards against nothing being returned; gives an Option[Klass].
const maybeRowToInstance = (Klass) => (rows) =>
  ((rows.length === 0) ? Option.none() : Option.of(new Klass(rows[0])));

const rowsToInstances = (Klass) => (rows) => {
  const result = [];
  for (let i = 0; i < rows.length; i += 1)
    result.push(new Klass(rows[i]));
  return result;
};

const wasUpdateSuccessful = (result) => result.rowCount === 1;

const resultCount = (result) => Number(result[0].count);


////////////////////////////////////////////////////////////////////////////////
// ERROR HANDLING

// Generic database failure handler; attempts to interpret DB exceptions.
// if it recognizes the problem, it translates it into a predictable
// error format. either way, it returns a Problem that can be handled
// downstream.
const postgresErrorToProblem = (error) => {
  // if this error has already been handled, just pass it on through. We might get
  // called multiple times because of how queryPromise chains are set up.
  if ((error != null) && (error.isProblem === true))
    return error;

  if (error.code === '23502') { // not_null_violation
    return reject(Problem.user.missingParameter({ field: error.column }));
  } else if (error.code === '23505') { // unique_violation
    const match = /^Key \(([^)]+)\)=\(([^)]+)\) already exists.$/.exec(error.detail);
    if (match != null) {
      const [ , field, value ] = match;
      return reject(Problem.user.uniquenessViolation({ field, value, table: error.table }));
    }
  } else if (error.code === '42703') { // undefined_column
    const match = /column "([^"]+)" of relation ".*" does not exist/.exec(error.message);
    if (match != null) {
      const [ , field ] = match;
      return reject(Problem.user.unexpectedAttribute({ field }));
    }
  }

  debugger; // automatically trip the debugger if it's attached.
  process.stderr.write(inspect(error));
  return reject(Problem.internal.unknown());
};


/* eslint-disable */ // or else it will complain about object-property-newline here
module.exports = {
  withTransaction, ensureTransaction,
  rowToInstance, maybeRowToInstance, rowsToInstances, wasUpdateSuccessful, resultCount,
  postgresErrorToProblem
};
/* eslint-enable */

