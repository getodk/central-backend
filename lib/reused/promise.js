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

// Make eslint happy: (TODO/CR: in my opinion this makes the code less readable)
let Mapped;

class ExplicitPromise {
  constructor(promise) { this.promise = promise; }
  get isExplicitPromise() { return true; }
  point() { return this.promise; }
  then(pass, fail) { return new Mapped(this, pass, fail); }
  catch(fail) { return this.then(identity, fail); }

  static of(promise) {
    return (promise.isExplicitPromise === true) ? promise : new ExplicitPromise(promise);
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

// Make eslint happy, part 2:
Mapped = MappedExplicitPromise;

const reject = Promise.reject.bind(Promise);
const resolve = (x) => ExplicitPromise.of(Promise.resolve(x));

module.exports = { isExplicitPromise, maybePoint, ExplicitPromise, MappedExplicitPromise, reject, resolve };

