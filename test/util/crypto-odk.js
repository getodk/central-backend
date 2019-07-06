const appRoot = require('app-root-path');
const { ceil } = Math;
const { createPublicKey, publicEncrypt, createHash, randomBytes, createCipheriv } = require('crypto');
const { RSA_NO_PADDING } = require('crypto').constants;
const { injectPemEnvelope, getSubmissionIvs } = require(appRoot + '/lib/util/crypto');


// here we implement some of the weirdo custom encryption things we need to
// properly simulate ODK collect.

// parse our public key and reformulate it into a proper PEM format
// to inflate into a real public key (grumble grumble grumble).
const extractPubkey = (xml) => {
  const keystr = /base64RsaPublicKey="([a-zA-Z0-9+\/]{392})"/.exec(xml)[1];
  const pem = `-----BEGIN PUBLIC KEY-----\n${keystr}\n-----END PUBLIC KEY-----`;
  return createPublicKey(Buffer.from(pem, 'utf8'));
};

const extractVersion = (xml) => {
  return /version="([^"]+)"/.exec(xml)[1];
};


// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING                                                                 WARNING
// WARNING       THIS IS NOT CRYPTOGRAPHICALLY SECURE CODE !!!!!!!!!       WARNING
// WARNING                   DO NOT USE IT FOR ANYTHING!                   WARNING
// WARNING                                                                 WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v v

const counter = Buffer.allocUnsafe(4);
const mgf1 = (seed, out) => {
  const iters = ceil(out.length / 32);
  for (let i = 0; i < iters; i++) {
    counter.writeInt32BE(i);
    createHash('sha256').update(seed).update(counter).digest().copy(out, i * 32);
  }
};
const xor = (x, y) => { for (let i = 0; i < x.length; i++) y[i] ^= x[i]; };
const padOaep = (payload) => {
  // formulate data block and seed:
  const db = Buffer.alloc(223);
  createHash('sha256').digest('buffer').copy(db); // write lhash
  db.writeUInt8(0x1, 190);
  payload.copy(db, 191);
  const seed = randomBytes(32);

  // apply oaep with mgf1:
  const dbMask = Buffer.allocUnsafe(223);
  mgf1(seed, dbMask);
  xor(dbMask, db); // db is now masked
  const seedMask = Buffer.allocUnsafe(32);
  mgf1(db, seedMask);
  xor(seedMask, seed); // seed is now masked

  // formulate output:
  const result = Buffer.alloc(256);
  seed.copy(result, 1);
  db.copy(result, 33);
  return result;
};
const padPkcs7 = (payload) => {
  const padLen = 16 - (payload.length % 16);
  const pad = Buffer.allocUnsafe(padLen);
  pad.fill(padLen);
  return Buffer.concat([ payload, pad ]);
};

// ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^ ^
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING


const sendEncrypted = (svc, version, pubkey) => async (instance, files = {}) => {
  // generate encryption information:
  const instanceId = /<instanceID>([a-z]+)<\/instanceID>/.exec(instance)[1];

  const aeskey = randomBytes(32);
  const paddedAeskey = padOaep(aeskey);
  const encAeskey = publicEncrypt({ key: pubkey, padding: RSA_NO_PADDING }, paddedAeskey);

  // generate and send envelope:
  const filesXml = '';
  const envelope = `<?xml version="1.0"?>
<data xmlns="http://opendatakit.org/submissions" id="simple" encrypted="yes", version="${version}">
<base64EncryptedKey>${encAeskey.toString('base64')}</base64EncryptedKey>
<encryptedXmlFile>submission.xml.enc</encryptedXmlFile>
${filesXml}
<base64EncryptedElementSignature>no</base64EncryptedElementSignature>
<meta xmlns="http://openrosa.org/xforms">
    <instanceID>${instanceId}</instanceID>
</meta>
</data>`;
  await svc.post('/v1/projects/1/forms/simple/submissions')
    .send(envelope).set('Content-Type', 'text/xml').expect(200);

  // generate and send encrypted instance:
  const iv = getSubmissionIvs(instanceId, aeskey, 1)[0];
  const cipher = createCipheriv('aes-256-cfb', aeskey, iv).setAutoPadding(false);
  const padded = padPkcs7(Buffer.from(instance, 'utf8'));
  const encInstance = Buffer.concat([ cipher.update(padded), cipher.final() ]);

  await svc.post(`/v1/projects/1/forms/simple/submissions/${instanceId}/attachments/submission.xml.enc`)
    .send(encInstance).expect(200);

};


module.exports = { extractPubkey, extractVersion, sendEncrypted, internal: { padOaep, padPkcs7 } };

