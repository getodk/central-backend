const { inspect } = require('util');
const { ExplicitPromise, resolve } = require('../reused/promise');
const bcrypt = require('bcrypt');

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
  while ((i < keys.length) && (ptr != null))
    ptr = ptr[keys[i++]];
  return ptr;
};

const ensureArray = (x) => (Array.isArray(x) ? x : [ x ]);

const incr = () => {
  let x = 0;
  return () => ++x;
};

const hashPassword = (plain) =>
  (isBlank(plain) ? resolve(null) : ExplicitPromise.of(bcrypt.hash(plain, 12)));
const verifyPassword = (plain, hash) =>
  ExplicitPromise.of(bcrypt.compare(plain, hash));

module.exports = { isBlank, printPairs, without, get, ensureArray, incr, hashPassword, verifyPassword };

