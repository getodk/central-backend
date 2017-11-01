const { postgresErrorToProblem } = require('../../util/db');
const { merge, identity } = require('../../util/util');


// The general premise behind the entire query system is as follows:
//
// Query definitions are given in modules containing simple named functions of
// the signature: (x, y, z) => (container) => Promise
//
// The queryModuleBuilder (builder.js) takes these modules and wraps each simple
// function such that when called with the first set of arguments (x, y, z), a
// FutureQuery is returned wrapping that operation. The query is not performed, but
// FutureQuery is a valid Thenable, allowing .then() chaining.
//
// The two key tricks to FutureQuery:
// 1. When .end() is called on a FutureQuery, the entire querytree is transformed
//    into a plain Promise tree and the rootmost database call is executed. If a
//    transaction is expected anywhere in the tree, it is formulated and distributed.
// 2. Each .then() resolve handler is wrapped in a thin layer of magic which detects
//    if the result is itself a FutureQuery, in which case the rest of the chain is
//    deferred, .end() is called on the inner FutureQuery with the appropriate
//    container context, and the rest of the promise chain is attached to the result
//    of the inner FutureQuery.
//
// This means in aggregate that you can write fluent chained calls, declaring
// transaction requirements inline and composing query operations together, without
// ever needing to worry about any of the boilerplate or grunt work in the actual
// module definition implementation or usage.
//
// The final piece of magic is that the endpoint() handler in util/http automatically
// calls .end() when it encounters a FutureQuery.


// Given a container context and Any x, calls .end on x if it is a FutureQuery.
// Automatically/recursively applies this behaviour to the .end result.
const maybeEnd = (container, x) => {
  if ((x != null) && (x.isFutureQuery === true))
    return maybeEnd(container, x.end(container));
  else
    return x;
};

// Given container, boolean transacting indicating whether a transaction is
// required, and a callback of (Container) => (Any|FutureQuery), does a few
// things in sequence:
// 1. Initiates a transaction on the container if necessary.
// 2. Calls the given callback with the appropriate resulting container.
// 3. Calls maybeEnd on the callback result, again with the appropriate container.
const performProc = (container, transacting, callback) => {
  if ((transacting !== true) || (container._transacting === true))
    return maybeEnd(container, callback(container));

  return container.db.transaction((trxn) => {
    const containerWithTrxn = merge(container, { db: trxn, _transacting: true });
    return maybeEnd(containerWithTrxn, callback(containerWithTrxn));
  });
};

// Given a parent FutureQuery, stores resolve/reject handlers in accordance to
// standard Thenable practices, and does the appropriate flatMapping with the
// resolve mapper result.
const mappedFutureQuery = (parent, defaultContainer, transacting, pass = identity, fail = identity) => ({
  isFutureQuery: true,

  // Perform the parent proc, then perform the map result proc if necessary.
  // Returns a plain Promise.
  end(container = defaultContainer) {
    return performProc(container, transacting, (localContainer) => {
      const wrappedPass = (result) => maybeEnd(localContainer, pass(result));
      return parent.end(localContainer).then(wrappedPass, fail);
    });
  },

  // Standard ES Promise Thenable interface:
  then(nextPass, nextFail) { return mappedFutureQuery(this, defaultContainer, transacting, nextPass, nextFail); },
  catch(nextFail) { return this.then(null, nextFail); }
});

// Given many FutureQueries, presents a single Promise Thenable which does the
// necessary work to .end all the queries and fold the result together.
const futureQueryList = (parents, defaultContainer, transacting, fold = identity, fail = identity) => ({
  isFutureQuery: true,

  end(container = defaultContainer) {
    return performProc(container, transacting, (localContainer) => {
      const shim = (result) => maybeEnd(localContainer, result);
      const queries = [];
      for (const parent of parents)
        queries.push(mappedFutureQuery(parent, localContainer, transacting, shim).end(localContainer));

      const wrappedFold = (results) => maybeEnd(localContainer, fold(results));
      return Promise.all(queries).then(wrappedFold, fail);
    });
  },

  // Standard ES Promise Thenable interface:
  then(nextPass, nextFail) { return mappedFutureQuery(this, defaultContainer, transacting, nextPass, nextFail); },
  catch(nextFail) { return this.then(null, nextFail); }
});

// Wraps a proc operation with FutureQuery machinery. proc is of the form
// (Container) => (Any|FutureQuery).
const futureQuery = (proc, defaultContainer, transacting) => ({
  isFutureQuery: true,

  // Perform the proc, handling errors as appropriate. Returns a plain Promise.
  end(container = defaultContainer) {
    return performProc(container, transacting, proc).catch(postgresErrorToProblem);
  },

  // Standard ES Promise Thenable interface:
  then(pass, fail) { return mappedFutureQuery(this, defaultContainer, transacting, pass, fail); },
  catch(fail) { return this.then(null, fail); }
});

module.exports = { mappedFutureQuery, futureQueryList, futureQuery };

