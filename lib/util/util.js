const { inspect } = require('util');

const isBlank = (x) => (x === null) || (x === undefined) || (x === '');

const printPairs = (obj) => {
  const result = [];
  for (const key of Object.keys(obj))
    result.push(`${key}: ${inspect(obj[key])}`);
  return result.join(', ');
};

const without = (keys, obj) => {
  const result = Object.assign({}, obj);
  for (const key of keys)
    delete result[key];
  return result;
};

const ensureArray = (x) => (Array.isArray(x) ? x : [ x ]);

const reject = Promise.reject.bind(Promise);
const resolve = Promise.resolve.bind(Promise);

module.exports = { isBlank, printPairs, without, ensureArray, reject, resolve };

