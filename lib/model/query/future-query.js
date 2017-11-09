const { postgresErrorToProblem } = require('../../util/db');
const { merge, identity, compose } = require('ramda');
const Option = require('../../reused/option');
const { maybePoint } = require('../../reused/promise');


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


// Given container, boolean transacting indicating whether a transaction is
// required, and a callback of (Container) => (Any|ExplicitPromise), does a few
// things in sequence:
// 1. Initiates a transaction on the container if necessary.
// 2. Calls the given callback with the appropriate resulting container.
// 3. Calls maybePoint on the callback result, again with the appropriate container.
const performProc = (container, transacting, callback) => {
  if ((transacting !== true) || (container._transacting === true))
    return maybePoint(container, callback(container));

  return container.db.transaction((trxn) => {
    const containerWithTrxn = merge(container, { db: trxn, _transacting: true });
    return maybePoint(containerWithTrxn, callback(containerWithTrxn));
  });
};

// Given a parent ExplicitPromise, stores resolve/reject handlers in accordance to
// standard Thenable practices, and does the appropriate flatMapping with the
// resolve mapper result.
const mappedFutureQuery = (parent, defaultContainer, transacting, pass = identity, fail = identity) => ({
  isExplicitPromise: true,

  // Perform the parent proc, then perform the map result proc if necessary.
  // Returns a plain Promise.
  point(container = defaultContainer) {
    return performProc(container, transacting, (localContainer) => {
      return parent.point(localContainer)
        .then(compose(maybePoint(localContainer), pass), fail);
    });
  },

  // Standard ES Promise Thenable interface:
  then(nextPass, nextFail) { return mappedFutureQuery(this, defaultContainer, transacting, nextPass, nextFail); },
  catch(nextFail) { return this.then(null, nextFail); }
});

// Given many FutureQueries, presents a single Promise Thenable which does the
// necessary work to .end all the queries and fold the result together.
const futureQueryList = (parents, defaultContainer, transacting, fold = identity, fail = identity) => ({
  isExplicitPromise: true,

  point(container = defaultContainer) {
    return performProc(container, transacting, (localContainer) => {
      const shim = (result) => maybePoint(localContainer, result);
      const queries = [];
      for (const parent of parents)
        queries.push(mappedFutureQuery(parent, localContainer, transacting, shim).point(localContainer));

      const wrappedFold = (results) => maybePoint(localContainer, fold(results));
      return Promise.all(queries).then(wrappedFold, fail);
    });
  },

  // Standard ES Promise Thenable interface:
  then(nextPass, nextFail) { return mappedFutureQuery(this, defaultContainer, transacting, nextPass, nextFail); },
  catch(nextFail) { return this.then(null, nextFail); }
});

// Wraps a proc operation with FutureQuery machinery. proc is of the form
// (Container) => (Any|ExplicitPromise).
const futureQuery = (proc, defaultContainer, transacting) => ({
  isExplicitPromise: true,

  // Perform the proc, handling errors as appropriate. Returns a plain Promise.
  point(container = defaultContainer) {
    return performProc(container, transacting, proc).catch(postgresErrorToProblem);
  },

  // Standard ES Promise Thenable interface:
  then(pass, fail) { return mappedFutureQuery(this, defaultContainer, transacting, pass, fail); },
  catch(fail) { return this.then(null, fail); }
});

module.exports = { mappedFutureQuery, futureQueryList, futureQuery };

