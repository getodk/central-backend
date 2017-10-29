const { inspect } = require('util');

const isBlank = (x) => (x === null) || (x === undefined) || (x === '');

const identity = (x) => x;

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

module.exports = { isBlank, identity, merge, without, printPairs, ensureArray, reject, resolve };

