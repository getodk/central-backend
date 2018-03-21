// Tasks are just a way of standardizing different computing constructions into
// a single container format and runner system. In the end, they're just Promises
// like anything else.
//
// Ultimately, they serve as a way of running application code outside the context
// of the full application, on the command line, and standardizing command-line
// output.

global.tap = (x) => { console.log(x); return x; };
const { promisify, inspect } = require('util');
const { merge, compose } = require('ramda');
const config = require('config');
const Problem = require('../util/problem');
const { connect } = require('../model/database');
const pkg = require('../model/package');
const { finalize } = require('../http/endpoint');
const { serialize } = require('../util/http');


////////////////////////////////////////////////////////////////////////////////
// TASK GENERATION
// If a task that requires a container context is run (.then is called on it)
// then we spawn a container and use that for all subsequent dependents. Unlike
// in the application, tasks are independent and share no state or transactions.
//
// We also provide a quick shortcut to promisify. If you have a function that
// already returns a Promise[Resolve[Serializable]|Problem] then congratulations,
// it's already a task!

const task = {
  // not thread-safe! but we don't have threads..
  withContainer: (taskdef) => (...args) => {
    const needsContainer = (task._container == null);
    if (needsContainer) task._container = pkg.withDefaults({ db: connect(config.get('default.database')) });

    const result = new Promise((resolve, reject) =>
      finalize(resolve, reject)(taskdef(task._container)(...args)));

    // and this is /definitely/ not thread-safe, but if we do it as a separate chain
    // we don't need to worry about reject/resolve result passthrough.
    if (needsContainer) {
      const cleanup = () => {
        task._container.db.destroy();
        delete task._container;
      };
      result.then(cleanup, cleanup);
    }

    return result;
  },
  noop: Promise.resolve(null),
  promisify
};


////////////////////////////////////////////////////////////////////////////////
// TASKRUNNER
// Essentially just does enough work to return command-line feedback.

const writeTo = (output) => (x) => output.write(`${x}\n`);
const writeToStderr = writeTo(process.stderr);
/* istanbul ignore next */
const fault = (error) => {
  // first print our error.
  if ((error != null) && (error.isProblem === true) && (error.httpCode < 500)) {
    writeToStderr(error.message);
    if (error.problemDetails != null)
      writeToStderr(inspect(error.problemDetails));
  } else {
    writeToStderr(inspect(error));
  }

  // then set a bad error code for exit.
  process.exitCode = 1;
};

// does its best to ensure that the result of the task is audit-logged.
// either logs a success or a failure with an attached error message.
const auditLog = task.withContainer(({ Audit }) => (action, success, error) => {
  const details =
    (success === true) ? { success: true }
    : (error == null) ? { success: false }
    : merge({ success: false }, Problem.serializable(error));
  return Audit.log(null, action, null, details);
});
const auditing = (action, t) => (typeof t === 'function')
  ? auditing(action, t())
  : t.then(
    ((result) => auditLog(action, true).then(
      (() => Promise.resolve(result)),
      ((auditError) => {
        writeToStderr('Failed to audit-log task success message!');
        fault(auditError);
        return Promise.resolve(result);
      }))),
    ((error) => auditLog(action, false, error).then(
      (() => Promise.reject(error)),
      ((auditError) => {
        writeToStderr('Failed to audit-log task failure message!');
        fault(auditError);
        return Promise.reject(error);
      }))));

// TODO: audit logging.
const run = (t) => (typeof t === 'function')
  ? run(t())
  : t.then(compose(writeTo(process.stdout), inspect, serialize), fault);


module.exports = { task, auditing, run };

