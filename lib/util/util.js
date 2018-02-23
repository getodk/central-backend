const { inspect } = require('util');
const { ExplicitPromise, resolve } = require('../reused/promise');
const bcrypt = require('bcrypt');
const { randomBytes } = require('crypto');

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

const hashPassword = (plain) =>
  (isBlank(plain) ? resolve(null) : ExplicitPromise.of(bcrypt.hash(plain, 12)));
const verifyPassword = (plain, hash) => ((isBlank(plain) || (isBlank(hash)))
  ? resolve(false)
  : ExplicitPromise.of(bcrypt.compare(plain, hash)));

const generateToken = () => randomBytes(48).toString('base64').replace(/\//g, '!');

module.exports = { isBlank, printPairs, without, get, ensureArray, incr, hashPassword, verifyPassword, generateToken };

