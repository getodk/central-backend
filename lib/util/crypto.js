// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Various useful cryptography functions, for doing things like hashing passwords,
// generating random tokens, and encrypting/decrypting data.

const bcrypt = require('bcrypt');
const digest = require('digest-stream');
const { createHash, randomBytes, generateKeyPair, pbkdf2, createPrivateKey, createPublicKey, createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt } = require('crypto');
const { RSA_NO_PADDING } = require('crypto').constants;
const { Transform } = require('stream');
const { PartialPipe } = require('./stream');
const { unpadPkcs1OaepMgf1Sha256 } = require('./quarantine/oaep');
const { unpadPkcs7 } = require('./quarantine/pkcs7');
const { promisify } = require('util');
const { resolve } = require('./promise');
const Problem = require('./problem');
const { isBlank } = require('./util');


////////////////////////////////////////////////////////////////////////////////
// PASSWORD/AUTH UTIL

// In tests, allow an insecure cost-factor for bcrypt.  In fact the minimum salt
// is 4, but this is only documented in the bcrypt lib's issue tracker.
// See: https://github.com/kelektiv/node.bcrypt.js/issues/870
const BCRYPT_COST_FACTOR = process.env.BCRYPT === 'insecure' ? 1 : 12;

// These functions call into bcrypt to hash or verify passwords.
const hashPassword = (plain) =>
  (isBlank(plain) ? resolve(null) : bcrypt.hash(plain, BCRYPT_COST_FACTOR));
const verifyPassword = (plain, hash) => ((isBlank(plain) || (isBlank(hash)))
  ? resolve(false)
  : bcrypt.compare(plain, hash));

// Returns a cryptographically random base64 string of a given length.
const generateToken = () => randomBytes(48).toString('base64')
  .replace(/\//g, '!')
  .replace(/\+/g, '$');

const isValidToken = (token) => /^[A-Za-z0-9!$]{64}$/.test(token);


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

// takes eg 'md5'/'sha1', then a cb func, then computes the digest with that algo
// and returns a promise of the result.
const digestWith = (algo) => (done) => digest(algo, 'hex', done);


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
const generateManagedKey = (passphrase = '') => new Promise((pass, fail) => {
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


////////////////////////////////////////////////////////////////////////////////
// PEM UTIL

// takes a pubkey buffer and whacks the start/end bits and newlines off of it to
// satiate the ODK spec. returns the inner base64 content.
const stripPemEnvelope = (pubkey) =>
  pubkey.toString('utf8').replace(/-----(?:BEGIN|END) PUBLIC KEY-----|\n/g, '');


////////////////////////////////////////////////////////////////////////////////
// BACKUPS ENCRYPTION UTIL

// given a Keys object (from generateManagedKey above), returns a tuple
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
const getPrivate = (keys, passphrase = '') =>
  promisify(pbkdf2)(passphrase, b64ToBuffer(keys.salt), 128000, 32, 'sha256').then((privkeyKey) => {
    try {
      const privkeyDecipher = createDecipheriv('aes-256-cbc', privkeyKey, b64ToBuffer(keys.iv));
      const privkeyPlain = privkeyDecipher.update(keys.privkey, 'base64') + privkeyDecipher.final();
      return createPrivateKey(privkeyPlain);
    } catch (ex) {
      throw (ex.reason === 'bad decrypt') ? Problem.user.undecryptable() : ex;
    }
  });

// returns Promise[(localiv: Base64String -> decipher: AESDecipher)].
const getLocalDecipherer = (keys, passphrase = '') =>
  getPrivate(keys, passphrase).then((privkey) => {
    const localkey = privateDecrypt(privkey, Buffer.from(keys.local.key, 'base64'));
    return (iv) => createDecipheriv('aes-256-cbc', localkey, b64ToBuffer(iv));
  });


////////////////////////////////////////////////////////////////////////////////
// ODK SUBMISSION DECRYPTION UTIL
// implements https://getodk.github.io/xforms-spec/encryption

// priv: Buffer, encAes: String containing base64
// returns Buffer
const getSubmissionKey = (priv, encAes) => {
  const padded = privateDecrypt({ key: priv, padding: RSA_NO_PADDING }, encAes);
  if (padded.length !== 256) throw Problem.user.undecryptable(); // not sure this can even ever happen.
  return unpadPkcs1OaepMgf1Sha256(padded);
};

// (instanceId: Utf8String, key: Buffer) => (n: Int) => Buffer(32) iv for index n
const getSubmissionIvs = (instanceId, key) => {
  // generate the initial iv and the iv cache.
  const ivs = [];
  const runner = createHash('md5').update(instanceId).update(key).digest();

  return (n) => {
    if (n >= ivs.length) {
      for (let idx = ivs.length; idx <= n; idx += 1) {
        runner[idx % 16] += 1;
        ivs[idx] = Buffer.from(runner);
      }
    }
    return ivs[n];
  };
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

// returns a Stream[Buffer] with the cleartext in it.
// because our padding length can't be more than 16 bytes, we need to reserve at
// least our last 16 bytes and we can flush the rest through. then when our decryptor
// stream is done working, we depad our held buffer and flush it. we actually
// keep around up to 32 bytes to avoid memory churn.
//
// we also take advantage of the AES 16 byte block here; we presume we will never
// receive a total of fewer than 16 bytes.
//
// also n.b. it is apparently /not/ safe (per the internet, i have not verified
// myself) to reuse a buffer across multiple stream push()es. so we allocade a
// new reserve buffer every time we flush one.
const empty = Buffer.alloc(0);
const streamSubmissionCleartext = (key, iv, input) => {
  const decipher = createDecipheriv('aes-256-cfb', key, iv).setAutoPadding(false);

  let reserve = empty;
  const transform = new Transform({
    transform(data, _, done) {
      const totalLen = reserve.length + data.length;
      if (totalLen < 32) {
        reserve = Buffer.concat([ reserve, data ]);
      } else if (data.length < 16) {
        const cutoff = totalLen - 16;
        this.push(reserve.subarray(0, cutoff));

        reserve = Buffer.concat([ reserve.subarray(cutoff), data ]);
      } else {
        const cutoff = data.length - 16;
        this.push(reserve);
        if (data.length > 16) this.push(data.subarray(0, cutoff));

        reserve = data.subarray(cutoff);
      }

      done();
    },
    flush(done) {
      const unpadded = unpadPkcs7(reserve);
      if (unpadded == null) throw Problem.user.undecryptable();
      this.push(unpadded);
      done();
    }
  });

  if (typeof input.pipe === 'function') {
    return PartialPipe.of(input, decipher, transform);
  } else {
    const result = PartialPipe.of(decipher, transform);
    decipher.write(input);
    decipher.end();
    return result;
  }
};

// we do things with this sealed function methodology rather than eg a class with
// members so keydata is always enclosed away from even the rest of the code.
//
// returns a function that takes a bunch of things (see below) and returns a
// Decipher Stream that should spit out a Buffer. if you do it all right.
const submissionDecryptor = (keys, passphrases) =>
  Promise.all(keys.map((k) => getPrivate(k.private, passphrases[k.id])))
    .then((list) => {
      // first, turn our list of privkeys into a lookup.
      const obj = {};
      for (let i = 0; i < keys.length; i += 1) obj[keys[i].id] = list[i];
      return obj;
    })
    .then((privs) => {
      // create some other data caches.
      const pubs = {};
      const ivs = {};

      // now return an object with decryption functions on it.
      return (data, keyId, localKey, instanceId, blobIndex) => {
        // get private key. bail if we don't have one.
        const priv = privs[keyId];
        if (priv == null) return null;

        // get the plaintext public key; decrypt if necessary.
        if (pubs[localKey] == null)
          pubs[localKey] = getSubmissionKey(priv, Buffer.from(localKey, 'base64'));
        const pub = pubs[localKey];

        // get the iv.
        if (ivs[instanceId] == null) ivs[instanceId] = getSubmissionIvs(instanceId, pub);
        const iv = ivs[instanceId](blobIndex);

        return streamSubmissionCleartext(pub, iv, data);
      };
    });


module.exports = {
  hashPassword, verifyPassword, generateToken, isValidToken,
  shasum, sha256sum, md5sum, digestWith,
  getPrivate, generateManagedKey, generateVersionSuffix,
  stripPemEnvelope,
  generateLocalCipherer, getLocalDecipherer,
  getSubmissionKey, getSubmissionIvs, getSubmissionCleartext, streamSubmissionCleartext,
  submissionDecryptor
};

