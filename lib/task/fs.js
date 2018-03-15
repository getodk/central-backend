const { readdir, createReadStream, createWriteStream, unlinkSync } = require('fs');
const { join, basename } = require('path');
const { merge } = require('ramda');
const tmp = require('tmp');
const archiver = require('archiver');
const { task } = require('./task');
const { generateLocalCipherer } = require('../util/crypto');


// we return a tuple of (tmpdir: String, rmtmpdir: Function).
const tmpdir = () => new Promise((resolve, reject) => {
  tmp.dir((err, tmpdirPath, tmpdirRm) => {
    if (err) return reject(err);
    resolve([ tmpdirPath, tmpdirRm ]);
  });
});

// but tmpfile does not compe with a cleanup (you'd just unlink it).
const tmpfile = task.promisify(tmp.file);

// given a directory containing files, a path to a tmpfile, and keyinfo data,
// encrypts and zips the files into that tmpfile location, along with decryption
// keyinfo.
// unlinks the plaintext files as they are processed.
const encryptedArchive = (directory, tmpFilePath, keys) => {
  const outStream = createWriteStream(tmpFilePath);
  const zipStream = archiver('zip', { zlib: { level: 9 } });
  zipStream.pipe(outStream);

  // create a cipher-generator for use below.
  const [ localkey, cipherer ] = generateLocalCipherer(keys);
  const local = { key: localkey, ivs: {} };

  // call up all files in the directory.
  return task.promisify(readdir)(directory).then((files) => new Promise((resolve, reject) => {
    // stream each file into the zip, encrypting on the way in. clean up each
    // plaintext file as soon as we're done with them.
    files.forEach((file) => {
      const filePath = join(directory, file);
      const [ iv, cipher ] = cipherer();
      local.ivs[basename(file)] = iv.toString('base64');

      const readStream = createReadStream(filePath);
      zipStream.append(readStream.pipe(cipher), { name: file });
      readStream.on('end', () => unlinkSync(filePath)); // sync to ensure completion.
    });

    // drop our key info into the zip and lock it in.
    // the local.ivs recordkeeping happens synchronously in the forEach loop so
    // this is ready to serialize by the time we get here.
    zipStream.append(JSON.stringify(merge(keys, { local })), { name: 'keys.json' });
    zipStream.finalize();

    // events to promise result.
    zipStream.on('end', resolve);
    zipStream.on('error', reject);
  }));
};

module.exports = { tmpdir, tmpfile, encryptedArchive };

