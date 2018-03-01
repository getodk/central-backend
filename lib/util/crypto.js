const bcrypt = require('bcrypt');
const { randomBytes } = require('crypto');
const { ExplicitPromise, resolve } = require('../reused/promise');
const { isBlank } = require('./util');

const hashPassword = (plain) =>
  (isBlank(plain) ? resolve(null) : ExplicitPromise.of(bcrypt.hash(plain, 12)));
const verifyPassword = (plain, hash) => ((isBlank(plain) || (isBlank(hash)))
  ? resolve(false)
  : ExplicitPromise.of(bcrypt.compare(plain, hash)));

const generateToken = () => randomBytes(48).toString('base64')
  .replace(/\//g, '!')
  .replace(/\+/g, '$');

module.exports = { hashPassword, verifyPassword, generateToken };

