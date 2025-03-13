// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('./problem');

////////////////////////////////////////////////////////////////////////////////
// PROMISE HELPERS
// prebind these so it doesn't have to be done ad-hoc all the time.

const reject = Promise.reject.bind(Promise);
const resolve = Promise.resolve.bind(Promise);


////////////////////////////////////////////////////////////////////////////////
// FLOW MODIFIERS

// restricts the length of time a promise can run for to some number of seconds,
// else throws a timeout Problem.
const timebound = (promise, bound = 600) => new Promise((pass, fail) => {
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    fail(Problem.internal.timeout());
  }, bound * 1000);
  const handle = (f) => (x) => {
    if (timedOut) return;
    clearTimeout(timeout);
    f(x);
  };
  promise.then(handle(pass), handle(fail));
});

////////////////////////////////////////////////////////////////////////////////
// .THEN HELPERS
// things that work well with .then; eg: .then(getOrNotFound)

const getOrElse = (orElse) => (option) => option.orElse(orElse);

// can't use option.orElse here, as constructing a reject is necessarily a rejection.
const getOrReject = (rejection) => (option) => (option.isDefined() ? option.get() : reject(rejection));
const getOrNotFound = getOrReject(Problem.user.notFound());

// Given a predicate function (value: Any) => Bool this helper will reject with the
// given Problem if the predicate returns anything but true. Otherwise passes through.
const rejectIf = (predicate, problem) => (value) => ((predicate(value) === true) ? reject(problem(value)) : value);

// given a lambda, will then give a function that takes an argument, applies it to
// the lambda, but ignores the result of the lambda and just gives the argument.
// eg: .then(ignoringResult((value) => value.doAction())) => returns value
const ignoringResult = (f) => (x) => f(x).then(() => x);


////////////////////////////////////////////////////////////////////////////////
// STREAM TO PROMISE

// helpful for using pipeline()
const rejectIfError = (rej) => (err) => { if (err != null) rej(err); };


////////////////////////////////////////////////////////////////////////////////
// MISC

const block = () => {
  let unlock;
  const lock = new Promise((done) => { unlock = done; });
  return [ lock, unlock ];
};

// inspired from https://stackoverflow.com/questions/54867318/sequential-execution-of-promise-all
const runSequentially = async (functions) => {
  const results = [];

  for (const fn of functions) {
    // reason:      we want to run functions sequentially
    // Current uses:
    // 1. prevent deadlock due to parallel queries starting sub-transactions
    //    See: #868 / worker.runJobs()
    // 2. reduce number of parallel database connections compared Promise.all()
    //    See: #1344 / Analytics.previewMetrics()

    // eslint-disable-next-line no-await-in-loop
    results.push(await fn());
  }

  return results;
};

module.exports = {
  reject, resolve,
  timebound,
  getOrElse, getOrReject, getOrNotFound, rejectIf, ignoringResult,
  rejectIfError,
  block, runSequentially
};

