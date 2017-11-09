const { curry, compose, identity } = require('ramda');

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

const mappedExplicitPromise = (parent, pass = identity, fail = identity) => ({
  isExplicitPromise: true,

  point(container) {
    return parent.point(container)
      .then(compose(maybePoint(container), pass), fail);
  },

  then(pass, fail) { return mappedExplicitPromise(this, pass, fail); },
  catch(fail) { return this.then(null, fail); }
});

const explicitPromise = (promise) => ({
  isExplicitPromise: true,

  point() { return promise; },

  then(pass, fail) { return mappedExplicitPromise(this, pass, fail); },
  catch(fail) { return this.then(null, fail); }
});

const reject = Promise.reject.bind(Promise);
const resolve = (x) => explicitPromise(Promise.resolve(x));

module.exports = { isExplicitPromise, maybePoint, mappedExplicitPromise, explicitPromise, reject, resolve };

