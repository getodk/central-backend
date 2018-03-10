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

const rejectIf = (predicate, problem) => (value) => ((predicate(value) === true) ? reject(problem(value)) : value);


module.exports = {
  isExplicitPromise, maybePoint, ExplicitPromise, MappedExplicitPromise,
  reject, resolve,
  getOrElse, getOrReject, getOrNotFound, rejectIf
};

