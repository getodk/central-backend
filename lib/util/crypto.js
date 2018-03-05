const bcrypt = require('bcrypt');
const { generatePrivateKey } = require('ursa');
const { randomBytes, pbkdf2, createCipheriv } = require('crypto');
const { ExplicitPromise, resolve } = require('../reused/promise');
const { isBlank } = require('./util');

const hashPassword = (plain) =>
  (isBlank(plain) ? resolve(null) : ExplicitPromise.of(bcrypt.hash(plain, 12)));
const verifyPassword = (plain, hash) => ((isBlank(plain) || (isBlank(hash)))
  ? resolve(false)
  : ExplicitPromise.of(bcrypt.compare(plain, hash)));

const generateToken = (bytes = 48) => randomBytes(bytes).toString('base64')
  .replace(/\//g, '!')
  .replace(/\+/g, '$');

// given a passphrase, returns: {
//   public: base64-encoded public RSA pubkey,
//   private: base64-encoded AES256-encrypted RSA privkey,
//   salt: base64-encoded PBKDF2 salt,
//   iv: AES initialization vector
// }
const generateKeypair = (passphrase = '') => ExplicitPromise.of(new Promise((resolve, reject) => {
  // first generate the literal keypair.
  const key = generatePrivateKey();
  const pubkey = key.toPublicPem('base64');
  const plainPrivkey = key.toPrivatePem('base64');

  // now use PBKDF=>symmkey=>AES to encrypt the privkey.
  const salt = generateToken();
  pbkdf2(passphrase, salt, 128000, 32, 'sha256', (err, key) => {
    if (err != null) return reject(err);

    const iv = generateToken(12);
    const cipher = createCipheriv('aes256', key, iv);
    const privkey = cipher.update(plainPrivkey, 'utf8', 'base64') + cipher.final('base64');

    return resolve({ pubkey, privkey, salt, iv });
  });
}));

module.exports = { hashPassword, verifyPassword, generateToken, generateKeypair };

