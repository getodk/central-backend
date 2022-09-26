const appRoot = require('app-root-path');
const { ceil } = Math;
const { createPublicKey, publicEncrypt, createHash, randomBytes, createCipheriv } = require('crypto');
const { RSA_NO_PADDING } = require('crypto').constants;
// eslint-disable-next-line import/no-dynamic-require
const { getSubmissionIvs } = require(appRoot + '/lib/util/crypto');


// here we implement some of the weirdo custom encryption things we need to
// properly simulate ODK collect.

// parse our public key and reformulate it into a proper PEM format
// to inflate into a real public key (grumble grumble grumble).
const extractPubkey = (xml) =>
  // eslint-disable-next-line no-use-before-define
  makePubkey(/base64RsaPublicKey="([a-zA-Z0-9+/]{392})"/.exec(xml)[1]);

const makePubkey = (b64) => {
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
  return createPublicKey(Buffer.from(pem, 'utf8'));
};

// eslint-disable-next-line arrow-body-style
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
  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < iters; i++) {
    counter.writeInt32BE(i);
    // eslint-disable-next-line newline-per-chained-call
    createHash('sha256').update(seed).update(counter).digest().copy(out, i * 32);
  }
};
// eslint-disable-next-line no-param-reassign, no-bitwise, no-plusplus
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


const encryptInstance = (pubkey, version, instance, files = {}) => {
  // get xmlFormId:
  const xmlFormId = /id="([^"]+)"/.exec(instance)[1];

  // generate encryption information:
  const instanceId = /<instanceID>([a-z]+)<\/instanceID>/.exec(instance)[1];

  const aeskey = randomBytes(32);
  const paddedAeskey = padOaep(aeskey);
  const encAeskey = publicEncrypt({ key: pubkey, padding: RSA_NO_PADDING }, paddedAeskey);

  const fileCount = Object.keys(files).length + 1;
  const ivs = getSubmissionIvs(instanceId, aeskey);

  // generate encrypted files:
  const encFiles = {};
  let filesXml = '';
  const filenames = Object.keys(files);
  // eslint-disable-next-line no-plusplus
  for (let idx = 0; idx < filenames.length; idx++) {
    const filename = filenames[idx];
    filesXml += `<media><file>${filename}</file></media>`;

    const cipher = createCipheriv('aes-256-cfb', aeskey, ivs(idx)).setAutoPadding(false);
    const padded = padPkcs7(Buffer.from(files[filename], 'utf8'));
    encFiles[filename] = Buffer.concat([ cipher.update(padded), cipher.final() ]);
  }

  // generate envelope:
  const envelope = `<?xml version="1.0"?>
<data xmlns="http://opendatakit.org/submissions" id="${xmlFormId}" encrypted="yes", version="${version}">
<base64EncryptedKey>${encAeskey.toString('base64')}</base64EncryptedKey>
<encryptedXmlFile>submission.xml.enc</encryptedXmlFile>
${filesXml}
<base64EncryptedElementSignature>no</base64EncryptedElementSignature>
<meta xmlns="http://openrosa.org/xforms">
    <instanceID>${instanceId}</instanceID>
</meta>
</data>`;

  // generate encrypted instance:
  const cipher = createCipheriv('aes-256-cfb', aeskey, ivs(fileCount - 1)).setAutoPadding(false);
  const padded = padPkcs7(Buffer.from(instance, 'utf8'));
  const encInstance = Buffer.concat([ cipher.update(padded), cipher.final() ]);

  return { xmlFormId, instanceId, envelope, encInstance, encFiles, encAeskey };
};

const sendEncrypted = (svc, version, pubkey) => async (instance, files = {}) => {
  const { xmlFormId, instanceId, envelope, encInstance, encFiles } = encryptInstance(pubkey, version, instance, files);

  await svc.post(`/v1/projects/1/forms/${xmlFormId}/submissions`)
    .send(envelope).set('Content-Type', 'text/xml').expect(200);

  await svc.post(`/v1/projects/1/forms/${xmlFormId}/submissions/${instanceId}/attachments/submission.xml.enc`)
    .send(encInstance).expect(200);

  for (const filename of Object.keys(encFiles))
    // eslint-disable-next-line no-await-in-loop
    await svc.post(`/v1/projects/1/forms/${xmlFormId}/submissions/${instanceId}/attachments/${filename}`)
      .send(encFiles[filename]).expect(200);
};


module.exports = {
  extractPubkey, makePubkey, extractVersion, encryptInstance, sendEncrypted,
  internal: { padOaep, padPkcs7 }
};

