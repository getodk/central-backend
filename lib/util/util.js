const { inspect } = require('util');
const { explicitPromise, resolve } = require('../reused/promise');
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

const ensureArray = (x) => (Array.isArray(x) ? x : [ x ]);

const hashPassword = (plain) => isBlank(plain) ? resolve(null) : explicitPromise(bcrypt.hash(plain, 12));
const verifyPassword = (plain, hash) => explicitPromise(bcrypt.compare(plain, hash));

module.exports = { isBlank, printPairs, without, ensureArray, hashPassword, verifyPassword };

