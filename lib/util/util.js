const { inspect } = require('util');

const isBlank = (x) => (x === null) || (x === undefined) || (x === '');

const merge = (...objs) => Object.assign({}, ...objs);
const without = (obj, ...reject) => {
  const result = Object.assign({}, obj);
  for (const key of reject)
    delete result[key];
  return result;
};

const printPairs = (obj) => {
  const result = [];
  for (const key in obj)
    result.push(`${key}: ${inspect(obj[key])}`);
  return result.join(', ');
};

const ensureArray = (x) => Array.isArray(x) ? x : [ x ];

const reject = Promise.reject.bind(Promise);
const resolve = Promise.resolve.bind(Promise);

const Trait = (classFunc) => (superclass) => (context) => classFunc(superclass(context), context);
const Subclass = (superclass, classFunc) => (context) => classFunc(superclass(context), context);

module.exports = { isBlank, merge, without, printPairs, ensureArray, reject, resolve, Trait, Subclass };

