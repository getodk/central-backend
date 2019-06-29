// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Various useful cryptography functions, for doing things like hashing passwords,
// generating random tokens, and encrypting/decrypting data.

const bcrypt = require('bcrypt');
const { createHash, randomBytes, generateKeyPair, pbkdf2, createPrivateKey, createPublicKey, createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt } = require('crypto');
const { promisify } = require('util');
const { resolve } = require('../util/promise');
const { isBlank } = require('./util');


////////////////////////////////////////////////////////////////////////////////
// PASSWORD/AUTH UTIL

// These functions call into bcrypt to hash or verify passwords.
const hashPassword = (plain) =>
  (isBlank(plain) ? resolve(null) : bcrypt.hash(plain, 12));
const verifyPassword = (plain, hash) => ((isBlank(plain) || (isBlank(hash)))
  ? resolve(false)
  : bcrypt.compare(plain, hash));

// Returns a cryptographically random base64 string of a given length.
const generateToken = (bytes = 48) => randomBytes(bytes).toString('base64')
  .replace(/\//g, '!')
  .replace(/\+/g, '$');


////////////////////////////////////////////////////////////////////////////////
// HASH UTIL

// Given some single input, computes the SHA1 sum. For large binary buffers or streams,
// use the sha npm package instead, as in lib/model/instance/blob.js.
const shasum = (input) => createHash('sha1').update(input).digest('hex');

// Given some single input, computes the SHA1 sum. For large binary buffers or streams,
// use the sha npm package instead, as in lib/model/instance/blob.js.
const sha256sum = (input) => createHash('sha256').update(input).digest('hex');

// Given some single input, computes the md5 sum. TODO: Haven't yet found a library
// that does the big ones praticularly well.
const md5sum = (input) => createHash('md5').update(input).digest('hex');


////////////////////////////////////////////////////////////////////////////////
// ENCRYPTION UTIL

// given a passphrase, returns Keys: {
//   pubkey: base64 public RSA pubkey,
//   privkey: base64 AES256-encrypted RSA privkey,
//   salt: base64 PBKDF2 salt,
//   iv: base64 AES initialization vector
// }
// uses awkward pass/fail verbiage here instead of resolve/reject to appease linter.
const generateKeypair = (passphrase = '') => new Promise((pass, fail) => {
  // first generate the literal keypair.
  generateKeyPair('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  }, (err, pubkeyPem, privkeyPlain) => {
    if (err) return fail(err);

    // now use PBKDF=>symmkey=>AES to encrypt the privkey.
    const salt = randomBytes(16);
    pbkdf2(passphrase, salt, 128000, 32, 'sha256', (err2, key) => {
      if (err2 != null) return fail(err2);

      const pubkey = Buffer.from(pubkeyPem, 'utf8').toString('base64');
      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-cbc', key, iv);
      const privkey = cipher.update(privkeyPlain, 'utf8', 'base64') + cipher.final('base64');

      return pass({ pubkey, privkey, salt: salt.toString('base64'), iv: iv.toString('base64') });
    });
  });
});

// given a Keys object (from generateKeypair above), returns a tuple
// (key: String, cipherer: (Unit -> [ iv: Buffer, cipher: AesCipher ])), where
// key is a base64 RSA-encrypted AES key.
const generateLocalCipherer = (keys) => {
  // create an AES symmkey. it will never be returned.
  const localkeyPlain = randomBytes(32);

  // encrypt the AES key with the RSA pubkey.
  const rsaPubkey = createPublicKey(Buffer.from(keys.pubkey, 'base64'));
  const localkey = publicEncrypt(rsaPubkey, localkeyPlain);

  return [
    localkey.toString('base64'),
    () => {
      // create a local iv and then initialize and return a cipherer with it.
      const iv = randomBytes(16);
      return [ iv, createCipheriv('aes-256-cbc', localkeyPlain, iv) ];
    }
  ];
};

// tiny helper to create 16-byte buffers from base64 strings.
const b64ToBuffer = (x) => Buffer.alloc(16, x, 'base64');

// given a key archive: { privkey, salt, iv, local: { key } }
// returns Promise[(localiv: Base64String -> decipher: AESDecipher)].
const getLocalDecipherer = (keys, passphrase = '') =>
  // retrieve the privkey aes-key:
  promisify(pbkdf2)(passphrase, b64ToBuffer(keys.salt), 128000, 32, 'sha256')
    .then((privkeyKey) => {
      // now retrieve the plaintext rsa privkey:
      const privkeyDecipher = createDecipheriv('aes-256-cbc', privkeyKey, b64ToBuffer(keys.iv));
      const privkeyPlain = privkeyDecipher.update(keys.privkey, 'base64') + privkeyDecipher.final();

      // now retrieve the local aes key:
      const privkey = createPrivateKey(privkeyPlain);
      const localkey = privateDecrypt(privkey, Buffer.from(keys.local.key, 'base64'));

      // now return a decipher-generator:
      return (iv) => createDecipheriv('aes-256-cbc', localkey, b64ToBuffer(iv));
    });


module.exports = {
  hashPassword, verifyPassword, generateToken,
  shasum, sha256sum, md5sum,
  generateKeypair, generateLocalCipherer, getLocalDecipherer
};

