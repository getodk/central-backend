const appRoot = require('app-root-path');
const { isBlank } = require(appRoot + '/lib/util/util');
const { resolve } = require(appRoot + '/lib/util/promise');
const crypto = require(appRoot + '/lib/util/crypto');
const { merge } = require('ramda');

module.exports = merge(crypto, {
  hashPassword: (plain) => resolve(isBlank(plain) ? null : plain),
  verifyPassword: (plain, hash) => resolve((isBlank(plain) || isBlank(hash))
    ? false
    : (plain === hash))
});

