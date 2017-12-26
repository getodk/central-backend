const { inspect } = require('util');
const { reject } = require('../reused/promise');
const Problem = require('../problem');
const Option = require('../reused/option');

////////////////////////////////////////////////////////////////////////////////
// QUERY RESULT INTERPRETATION

// Assumes a row will be returned for sure; instantiates and returns.
const rowToInstance = (Klass) => (rows) => new Klass(rows[0]);

// Guards against nothing being returned; gives an Option[Klass].
const maybeRowToInstance = (Klass) => (rows) =>
  Option.of(rows[0]).map((x) => new Klass(x));

const rowsToInstances = (Klass) => (rows) => {
  const result = [];
  for (let i = 0; i < rows.length; i += 1)
    result.push(new Klass(rows[i]));
  return result;
};

// TODO: should perhaps reject if unsuccessful.
const wasUpdateSuccessful = (result) => result > 0;

const resultCount = (result) => Number(result[0].count);


////////////////////////////////////////////////////////////////////////////////
// ERROR HANDLING

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
  rowToInstance, maybeRowToInstance, rowsToInstances, wasUpdateSuccessful, resultCount,
  postgresErrorToProblem
};
/* eslint-enable */

