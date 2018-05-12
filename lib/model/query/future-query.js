// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// The general premise behind the entire query system is as follows:
//
// Query definitions are given in modules containing simple named functions of
// the signature: (x, y, z) => (container) => Promise
//
// The queryModuleBuilder (builder.js) takes these modules and wraps each simple
// function such that when called with the first set of arguments (x, y, z), a
// FutureQuery is returned wrapping that operation. The query is not performed, but
// FutureQuery is a valid ExplicitPromise, allowing thenable chaining and deferred
// resolution.
//
// The two key tricks to FutureQuery:
// 1. When .point() is called on a FutureQuery, the entire querytree is transformed
//    into a plain Promise tree and the rootmost database call is executed. If a
//    transaction is expected anywhere in the tree, it is formulated and distributed.
// 2. Each .then() resolve handler is wrapped in a thin layer of magic which detects
//    if the result is itself a FutureQuery, in which case the rest of the chain is
//    deferred, .point() is called on the inner FutureQuery with the appropriate
//    container context, and the rest of the promise chain is attached to the result
//    of the inner FutureQuery.
//
// This means in aggregate that you can write fluent chained calls, declaring
// transaction requirements inline and composing query operations together, without
// ever needing to worry about any of the boilerplate or grunt work in the actual
// module definition implementation or usage.


const { postgresErrorToProblem } = require('../../util/db');
const { merge, identity, compose } = require('ramda');
const { maybePoint, reject } = require('../../util/promise');

// Given container, boolean transacting indicating whether a transaction is
// required, and a callback of (Container) => (Any|ExplicitPromise), does a few
// things in sequence:
// 1. Initiates a transaction on the container if necessary.
// 2. Calls the given callback with the appropriate resulting container.
// 3. Calls maybePoint on the callback result, again with the appropriate container.
const performProc = (container, transacting, callback) => {
  if ((transacting !== true) || (container._alreadyTransacting === true))
    return maybePoint(container, callback(container));

  return container.db.transaction((trxn) => {
    const containerWithTrxn = merge(container, { db: trxn, _alreadyTransacting: true });
    return maybePoint(containerWithTrxn, callback(containerWithTrxn));
  });
};

// A simple base class that provides a lot of common behaviour:
class FutureQuery {
  constructor(proc, options = {}) {
    this.proc = proc;
    this.options = options;
  }

  get isExplicitPromise() { return true; }

  transacting() {
    return (this.options.transacting === true) ? this : this._mapped({ transacting: true });
  }

  point(container = this.options.container) {
    return performProc(container, this.options.transacting, this.proc).catch(postgresErrorToProblem);
  }

  _mapped(options) {
    // fixing the following lint makes the code /more/ confusing.
    return new MappedFutureQuery(this, merge(this.options, options)); // eslint-disable-line no-use-before-define
  }

  then(pass, fail) { return this._mapped({ pass, fail }); }
  catch(fail) { return this._mapped({ fail }); }
}

// Given a parent ExplicitPromise, stores resolve/reject handlers in accordance to
// standard Thenable practices, and does the appropriate flatMapping with the
// resolve mapper result.
const defaultMapOptions = { pass: identity, fail: reject };
class MappedFutureQuery extends FutureQuery {
  constructor(parent, options = {}) {
    super(null, merge(defaultMapOptions, options));
    this.parent = parent;
  }

  point(container = this.options.container) {
    return performProc(container, this.options.transacting, (localContainer) =>
      this.parent.point(localContainer)
        .then(compose(maybePoint(localContainer), this.options.pass), this.options.fail));
  }
}

// Given many FutureQueries, presents a single Promise Thenable which does the
// necessary work to .end all the queries and fold the result together.
const defaultFoldOptions = { fold: identity, fail: reject };
class FoldedFutureQuery extends FutureQuery {
  constructor(parents, options = {}) {
    super(null, merge(defaultFoldOptions, options));
    this.parents = parents;
  }

  point(container = this.options.container) {
    return performProc(container, this.options.transacting, (localContainer) => {
      const shim = (result) => maybePoint(localContainer, result);
      const queries = [];
      for (const parent of this.parents)
        queries.push(new MappedFutureQuery(parent, { container: localContainer, transacting: this.options.transacting, pass: shim }).point(localContainer));

      const wrappedFold = (results) => maybePoint(localContainer, this.options.fold(results));
      return Promise.all(queries).then(wrappedFold, this.options.fail);
    });
  }
}

module.exports = { FutureQuery, MappedFutureQuery, FoldedFutureQuery };

