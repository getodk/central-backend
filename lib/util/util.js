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

const get = (x, keys) => {
  let ptr = x;
  let i = 0;
  while ((i < keys.length) && (ptr != null)) {
    ptr = ptr[keys[i]];
    i += 1;
  }
  return ptr;
};

const ensureArray = (x) => (Array.isArray(x) ? x : [ x ]);

const incr = () => {
  let x = 0;
  return () => {
    x += 1;
    return x;
  };
};

module.exports = { isBlank, printPairs, without, get, ensureArray, incr };

