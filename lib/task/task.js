// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Tasks are just a way of standardizing different computing constructions into
// a single container format and runner system. In the end, they're just Promises
// like anything else.
//
// Ultimately, they serve as a way of running application code outside the context
// of the full application, on the command line, and standardizing command-line
// output.

const { inspect } = require('util');
const { mergeRight, compose, identity } = require('ramda');
const config = require('config');
const container = require('../model/container');
const Problem = require('../util/problem');
const Option = require('../util/option');
const { slonikPool } = require('../external/slonik');
const jsonSerialize = require('../util/json-serialize');


// initialize modules we need to put in the container:
const env = config.get('default.env');
const { mailer } = require('../external/mail');
const mail = mailer(mergeRight(config.get('default.email'), { env }));
const odkAnalytics = require('../external/odk-analytics').init(config.get('default.external.analytics'));
const s3 = require('../external/s3').init(config.get('default.external.s3blobStore'));
const { Sentry } = require('../external/sentry');


////////////////////////////////////////////////////////////////////////////////
// TASK GENERATION
// If a task that requires a container context is run (.then is called on it)
// then we spawn a container and use that for all subsequent dependents. Unlike
// in the application, tasks are independent and share no state or transactions.
//
// A task takes the form of a function that returns:
//
//     Promise[Resolve[Serializable]|Problem]

const task = {
  withContainer: (taskdef) => (...args) => {
    // Allow container re-use in tests
    const _container = task._testContainer ?? container.withDefaults({ db: slonikPool(config.get('default.database')), env, mail, task: true, odkAnalytics, s3 });

    return Sentry.startSpan(
      {
        name: 'task.test', // TODO rename for real jobs?  Maybe derive from stack?
        op: JSON.stringify(process.argv),
      },
      async () => {
        try {
          return await taskdef(_container)(...args);
        } catch (err) {
          Sentry.captureException(err);
          throw err;
        } finally {
          if (_container !== task._testContainer) await _container.db.end();
        }
      },
    );
  },
};


////////////////////////////////////////////////////////////////////////////////
// TASKRUNNER
// Essentially just does enough work to return command-line feedback.

// Some helper functions used below to format console output after the task completes.
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

// auditing() does its best to ensure that the result of the task is audit-logged.
// either logs a success or a failure with an attached error message. Takes
// action: String indicating the audit action and t: Task|(() => Task).
const auditLog = task.withContainer(({ Audits }) => (action, success, details) =>
  Audits.log(null, action, null, mergeRight({ success }, details)));

const auditing = (action, t) => ((typeof t === 'function')
  ? auditing(action, t())
  : t.then(
    ((result) => auditLog(action, true, result).then(
      (() => Promise.resolve(result)),
      ((auditError) => {
        writeToStderr('Failed to audit-log task success message!');
        fault(auditError);
        return Promise.resolve(result);
      })
    )),
    ((error) => auditLog(action, false, Option.of(error).map(Problem.serializable).orNull()).then(
      (() => Promise.reject(error)),
      ((auditError) => {
        writeToStderr('Failed to audit-log task failure message!');
        fault(auditError);
        return Promise.reject(error);
      })
    ))
  ));


// takes a messageId, and emails the sysadmin account with the given messageId
// email if the task fails.
const email = task.withContainer(({ mail, env }) => (messageId) => // eslint-disable-line no-shadow
  mail(env.sysadminAccount, messageId));
const emailing = (messageId, t) => ((typeof t === 'function')
  ? emailing(messageId, t())
  : t.then(identity, (err) => {
    const fail = () => { throw err; };
    return email(messageId).then(fail, fail);
  }));

// Executes a task and writes the result of that task to stdout. Takes
// t: Task|(() => Task).
const run = (t) => ((typeof t === 'function')
  ? run(t())
  : t.then(compose(writeTo(process.stdout), jsonSerialize), fault));


module.exports = { task, auditing, emailing, run };

