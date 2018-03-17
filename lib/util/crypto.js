const bcrypt = require('bcrypt');
const { generatePrivateKey, createPublicKey, createPrivateKey } = require('ursa');
const { randomBytes, pbkdf2, createCipheriv, createDecipheriv } = require('crypto');
const { promisify } = require('util');
const { ExplicitPromise, resolve } = require('../util/promise');
const { isBlank } = require('./util');


////////////////////////////////////////////////////////////////////////////////
// PASSWORD/AUTH UTIL

const hashPassword = (plain) =>
  (isBlank(plain) ? resolve(null) : ExplicitPromise.of(bcrypt.hash(plain, 12)));
const verifyPassword = (plain, hash) => ((isBlank(plain) || (isBlank(hash)))
  ? resolve(false)
  : ExplicitPromise.of(bcrypt.compare(plain, hash)));

const generateToken = (bytes = 48) => randomBytes(bytes).toString('base64')
  .replace(/\//g, '!')
  .replace(/\+/g, '$');


////////////////////////////////////////////////////////////////////////////////
// ENCRYPTION UTIL

// given a passphrase, returns Keys: {
//   pubkey: base64 public RSA pubkey,
//   privkey: base64 AES256-encrypted RSA privkey,
//   salt: base64 PBKDF2 salt,
//   iv: base64 AES initialization vector
// }
const generateKeypair = (passphrase = '') => ExplicitPromise.of(new Promise((resolve, reject) => {
  // first generate the literal keypair.
  const key = generatePrivateKey();
  const pubkey = key.toPublicPem('base64');
  const privkeyPlain = key.toPrivatePem();

  // now use PBKDF=>symmkey=>AES to encrypt the privkey.
  const salt = randomBytes(16);
  pbkdf2(passphrase, salt, 128000, 32, 'sha256', (err, key) => {
    if (err != null) return reject(err);

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes256', key, iv);
    const privkey = cipher.update(privkeyPlain, 'binary', 'base64') + cipher.final('base64');

    return resolve({ pubkey, privkey, salt: salt.toString('base64'), iv: iv.toString('base64') });
  });
}));

// given a Keys object (from generateKeypair above), returns a tuple
// (key: String, cipherer: (Unit -> [ iv: Buffer, cipher: AesCipher ])), where
// key is a base64 RSA-encrypted AES key.
const generateLocalCipherer = (keys) => {
  // create an AES symmkey. it will never be returned.
  const localkeyPlain = randomBytes(32);

  // encrypt the AES key with the RSA pubkey.
  const rsaPubkey = createPublicKey(keys.pubkey, 'base64');
  const localkey = rsaPubkey.encrypt(localkeyPlain, 'binary', 'base64');

  return [
    localkey,
    () => {
      // create a local iv and then initialize and return a cipherer with it.
      const iv = randomBytes(16);
      return [ iv, createCipheriv('aes256', localkeyPlain, iv) ];
    }
  ];
};

// tiny helper to create 16-byte buffers from base64 strings.
const b64ToBuffer = (x) => Buffer.alloc(16, x, 'base64');

// given a key archive: { privkey, salt, iv, local: { key } }
// returns Promise[(localiv: Base64String -> decipher: AESDecipher)].
const getLocalDecipherer = (keys, passphrase = '') => ExplicitPromise.of(
  // retrieve the privkey aes-key:
  promisify(pbkdf2)(passphrase, b64ToBuffer(keys.salt), 128000, 32, 'sha256')
    .then((privkeyKey) => {
      // now retrieve the plaintext rsa privkey:
      const privkeyDecipher = createDecipheriv('aes256', privkeyKey, b64ToBuffer(keys.iv));
      const privkeyPlain = privkeyDecipher.update(keys.privkey, 'base64') + privkeyDecipher.final();

      // now retrieve the local aes key:
      const privkey = createPrivateKey(privkeyPlain);
      const localkey = privkey.decrypt(keys.local.key, 'base64');

      // now return a decipher-generator:
      return (iv) => createDecipheriv('aes256', localkey, b64ToBuffer(iv));
    }));


module.exports = {
  hashPassword, verifyPassword,
  generateToken,
  generateKeypair, generateLocalCipherer, getLocalDecipherer
};

