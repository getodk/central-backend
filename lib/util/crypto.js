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
const { RSA_NO_PADDING } = require('crypto').constants;
const { unpadPkcs1OaepMgf1Sha256 } = require('./quarantine/oaep');
const { unpadPkcs7 } = require('./quarantine/pkcs7');
const { promisify } = require('util');
const { resolve } = require('../util/promise');
const Problem = require('../util/problem');
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
// MANAGED/PBKDF KEYPAIR GENERATION
// nb: aes-256-cbc is a different block mode than the aes-256-cfb used for
//     submission decryption below. this means that Central's own AES encryption
//     for storing the private key uses CBC, but then /that/ AES key is used in
//     CFB mode to actually decrypt the content.

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

// generate a short unique string based on the current epoch millisecond.
// TODO: sort of an awkward place for this, it does no crypto operations.
const generateVersionSuffix = () => {
  const now = Buffer.alloc(6);
  now.writeUIntBE((new Date()).getTime(), 0, 6);
  return `[encrypted:${now.toString('base64')}]`;
};

// takes a pubkey buffer and whacks the start/end bits and newlines off of it to
// satiate the ODK spec. returns the inner base64 content.
const stripPemEnvelope = (pubkey) =>
  pubkey.toString('utf8').replace(/-----(?:BEGIN|END) PUBLIC KEY-----|\n/g, '');


////////////////////////////////////////////////////////////////////////////////
// BACKUPS ENCRYPTION UTIL

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


////////////////////////////////////////////////////////////////////////////////
// ODK SUBMISSION DECRYPTION UTIL
// implements https://opendatakit.github.io/xforms-spec/encryption

// priv: Buffer, encAes: String containing base64
// returns Buffer
const getSubmissionKey = (priv, encAes) => {
  const padded = privateDecrypt({ key: createPrivateKey(priv), padding: RSA_NO_PADDING }, encAes);
  if (padded.length !== 256) throw Problem.user.undecryptable(); // not sure this can even ever happen.
  return unpadPkcs1OaepMgf1Sha256(padded);
};

// instanceId: Utf8String, key: Buffer, n: integer
// returns an n-size Array of ivs as Buffers, one for each indexed file
const getSubmissionIvs = (instanceId, key, n) => {
  const result = new Array(n);
  const iv = createHash('md5').update(instanceId).update(key).digest();
  for (let i = 0; i < n; i += 1) {
    iv[i % 16] += 1;
    result[i] = Buffer.from(iv);
  }
  return result;
};

// so, for the backups decryption above, we hand back a Decipher instance that
// the consumer is allowed to use as they will (either with .update/.final directly,
// or to use as a piped stream). unfortunately, in this case we need to do some
// work to manually remove padding, because the decipher instance will not do it
// for us. so instead, we offer two fixed/sealed APIs: one that will do all the
// work in one go (which makes testing easier), and one that works on a stream
// (which we use pretty much all of the time in practice).

// returns a Buffer with the cleartext in it.
const getSubmissionCleartext = (key, iv, input) => {
  const decipher = createDecipheriv('aes-256-cfb', key, iv).setAutoPadding(false);
  const padded = Buffer.concat([ decipher.update(input), decipher.final() ]);
  const result = unpadPkcs7(padded);
  if (result == null) throw Problem.user.undecryptable();
  return result;
};


module.exports = {
  hashPassword, verifyPassword, generateToken,
  shasum, sha256sum, md5sum,
  generateKeypair, generateVersionSuffix, stripPemEnvelope,
  generateLocalCipherer, getLocalDecipherer,
  getSubmissionKey, getSubmissionIvs, getSubmissionCleartext
};

