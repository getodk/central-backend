// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This file contains two things: the generic ExplicitPromise declaration, and
// some helper functions that make dealing with Promise chains cleaner.
// See the Contribution guide and lib/model/query/future-query.js for lengthy
// explanations on what ExplicitPromises are and why we need them.

const { curry, compose, identity } = require('ramda');
const Problem = require('./problem');

////////////////////////////////////////////////////////////////////////////////
// EXPLICIT PROMISE
//
// An ExplicitPromise is a promise whose computation is not triggered until a
// point() method is called. Resolution is thereupon passed up the entire promise
// tree and executed starting from the rootmost point.
//
// A small bit of magic: the endpoint() handler in util/http automatically
// calls .point() when it encounters a ExplicitPromise.

// Given Any x, returns true only if x is a ExplicitPromise of some kind.
const isExplicitPromise = (x) => (x != null) && (x.isExplicitPromise === true);

// Given a container context and Any x, calls .point on x if it is an Explicit
// Promise. Automatically/recursively applies this behaviour to the result.
const maybePoint = curry((container, x) => {
  if (isExplicitPromise(x)) return maybePoint(container, x.point(container));
  if ((x != null) && (x.then != null)) return x.then(maybePoint(container));
  return x;
});

class ExplicitPromise {
  constructor(promise) { this.promise = promise; }
  get isExplicitPromise() { return true; }
  point() { return this.promise; }

  // fixing the following lint makes the code /more/ confusing.
  then(pass, fail) { return new MappedExplicitPromise(this, pass, fail); } // eslint-disable-line no-use-before-define
  catch(fail) { return this.then(identity, fail); }

  static of(promise) {
    return (promise.isExplicitPromise === true) ? promise : new ExplicitPromise(promise);
  }

  // this makes it easy to convert legacy CPS node APIs into ExplicitPromises.
  // Example usage:
  // ExplicitPromise.fromCallback((cb) => fs.readFile('path', cb));
  static fromCallback(op) {
    return ExplicitPromise.of(new Promise((resolve, reject) => op((error, result) =>
      ((error != null) ? reject(error) : resolve(result)))));
  }
}

class MappedExplicitPromise extends ExplicitPromise {
  constructor(parent, pass = identity, fail) {
    super();
    this.parent = parent;
    this.pass = pass;
    this.fail = fail;
  }
  point(container) {
    return this.parent.point(container)
      .then(compose(maybePoint(container), this.pass), this.fail);
  }
}


////////////////////////////////////////////////////////////////////////////////
// PROMISE HELPERS
// just like Promise.reject and Promise.resolve but gives ExplicitPromises.

const reject = Promise.reject.bind(Promise);
const resolve = (x) => ExplicitPromise.of(Promise.resolve(x));


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


module.exports = {
  isExplicitPromise, maybePoint, ExplicitPromise, MappedExplicitPromise,
  reject, resolve,
  getOrElse, getOrReject, getOrNotFound, rejectIf
};

