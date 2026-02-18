// Functions for handling legacy backups (as once returned by /v1/backup)

const { createWriteStream } = require('fs');
const { promisify } = require('node:util');
const { join, } = require('path');
const yauzl = require('yauzl');
const Problem = require('./problem');
const { getLocalDecipherer } = require('./crypto');
const { PartialPipe } = require('./stream');
const { spawn } = require('node:child_process');


// given the path of a legacy zip archive file as once returned by /v1/backup,
// unzips and decrypts the zip contents to the given directory.
// the passphrase must be correct to succeed.
const decryptFromLegacyArchive = (archivePath, directory, passphrase = '') =>
  // we take a slower readpath here than in the test util to safeguard against
  // various zipbombing attacks.
  promisify(yauzl.open)(archivePath, { autoClose: false, lazyEntries: true, validateEntrySizes: true })
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
                  outStream.on('finish', () => {
                    // upon each file completion, do a count to see if we're done.
                    completed += 1;
                    if (completed === entries.length) resolve();
                  });
                  decipher.on('error', () => reject(Problem.user.undecryptable()));
                  PartialPipe.of(inStream, decipher, outStream).pipeline(reject);
                });
              });
            }, reject);
          });
        });
      });
    }));


// Given a directory containing a valid pg_dump produced by the above task, produces a sql-stream from that state
const getRestoreStreamFromDumpDir = async (directory) => {
  const restoreProcess = spawn(
    'pg_restore',
    [
      '--no-acl',
      '--no-owner',
      '--exit-on-error',
      '--format', 'd',
      '--file', '-',
      directory,
    ],
  );
  return restoreProcess;
};


module.exports = { decryptFromLegacyArchive, getRestoreStreamFromDumpDir };

