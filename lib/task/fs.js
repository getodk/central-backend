// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Contains tasks that perform filesystem operations like creating temporary
// files or directories or encrypting files. See ./task.js for more information
// on what tasks are.

const { readdir, createReadStream, createWriteStream, unlinkSync } = require('fs');
const { join, basename } = require('path');
const { mergeRight } = require('ramda');
const archiver = require('archiver');
const yauzl = require('yauzl');
const { task } = require('./task');
const Problem = require('../util/problem');
const { generateLocalCipherer, getLocalDecipherer } = require('../util/crypto');


// given a directory containing files, a path to a tmpfile, and keyinfo data,
// encrypts and zips the files into that tmpfile location, along with decryption
// keyinfo.
// unlinks the plaintext files as they are processed.
const encryptToArchive = (directory, tmpFilePath, keys) => {
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
    // TODO: copypasted for now to lib/resources/backup
    for (const file of files) {
      const filePath = join(directory, file);
      const [ iv, cipher ] = cipherer();
      local.ivs[basename(file)] = iv.toString('base64');

      const readStream = createReadStream(filePath);
      zipStream.append(readStream.pipe(cipher), { name: file });
      readStream.on('end', () => unlinkSync(filePath)); // sync to ensure completion.
    }

    // drop our key info into the zip and lock it in.
    // the local.ivs recordkeeping happens synchronously in the forEach loop so
    // this is ready to serialize by the time we get here.
    zipStream.append(JSON.stringify(mergeRight(keys, { local })), { name: 'keys.json' });
    zipStream.finalize();

    // events to promise result.
    zipStream.on('end', resolve);
    zipStream.on('error', reject);
  }));
};

// given an archive file path in the format put out by encryptToArchive above,
// unzips and decrypts the zip contents to the given directory. the passphrase
// must be correct to succeed.
const decryptFromArchive = (archivePath, directory, passphrase = '') =>
  // we take a slower readpath here than in the test util to safeguard against
  // various zipbombing attacks.
  task.promisify(yauzl.open)(archivePath, { autoClose: false, lazyEntries: true, validateEntrySizes: true })
    .then((zipfile) => new Promise((resolve, reject) => {
      const entries = [];
      let completed = 0;

      // top-level errors indicate either that something is wrong with the zipfile
      // construction at large, or else that a file has violated its advertised
      // uncompressedSize, which is another zipbomb redflag.
      zipfile.on('error', reject);

      // first we read all the records in the zipfile central directory.
      // NOTE: contrary to the advice of the zipfile library, we do not check or enforce
      // any limits here, because it's trying to protect against user-submitted zipbomb
      // DoS attacks, and this isn't a user-facing interface.
      zipfile.on('entry', (entry) => {
        if (entry.fileName === 'keepalive') {
          zipfile.readEntry();
          return;
        }

        entries.push(entry);
        zipfile.readEntry();
      });
      zipfile.readEntry();

      // once we have read all the entries this event gets emitted, whereupon we
      // attempt to find and parse the keyfile, then use those keys to stream out
      // all the remaining files to the given directory.
      zipfile.on('end', () => {
        const keyFileEntry = entries.find((entry) => entry.fileName === 'keys.json');
        if (keyFileEntry == null)
          return reject(Problem.user.missingParameter({ field: 'keyfile' }));

        // first uncompress keys, we'll need that to make sense of any of the rest.
        zipfile.openReadStream(keyFileEntry, (error, keyFileStream) => {
          if (error != null) return reject(error);

          const chunks = [];
          keyFileStream.on('data', (chunk) => chunks.push(chunk));
          keyFileStream.on('end', () => {
            completed += 1; // entries contains all files, so mark one completion for keyfile.
            const keyFileContent = Buffer.concat(chunks);
            let keys, localivs; /* not actually mutable, just scoping nonsense. */ // eslint-disable-line
            try {
              keys = JSON.parse(keyFileContent.toString('utf8'));
              localivs = keys.local.ivs;
            } catch (_) {
              return reject(Problem.user.unparseable({ format: 'keyfile JSON', rawLength: keyFileContent.byteLength }));
            }

            // we can create a decipher-creator now that we have keys.
            getLocalDecipherer(keys, passphrase).then((decipherer) => {
              // decrypt all the files in the zip save for keys.json
              entries.forEach((entry) => {
                if (entry.fileName === 'keys.json') return;
                if (localivs[entry.fileName] == null) return reject(Problem.user.missingParameter(`${entry.fileName} local key`));
                const outStream = createWriteStream(join(directory, entry.fileName));
                const decipher = decipherer(localivs[entry.fileName]);

                zipfile.openReadStream(entry, (streamError, inStream) => {
                  if (streamError) return reject(streamError);
                  inStream.on('end', () => {
                    // upon each file completion, do a count to see if we're done.
                    completed += 1;
                    if (completed === entries.length) resolve();
                  });
                  decipher.on('error', () => reject(Problem.user.undecryptable()));
                  inStream.pipe(decipher).pipe(outStream);
                });
              });
            }, reject);
          });
        });
      });
    }));

module.exports = { encryptToArchive, decryptFromArchive };

