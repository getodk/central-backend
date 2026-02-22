const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const appRoot = require('app-root-path');
const { promisify } = require('util');
const { readdir, readdirSync, readFile, statSync, unlinkSync, writeFile, createReadStream, createWriteStream } = require('fs');
const { join, basename } = require('path');
const tmp = require('tmp');
const archiver = require('archiver');
const { testTask } = require('../setup');
const { generateManagedKey, generateLocalCipherer } = require(appRoot + '/lib/util/crypto');
const { decryptFromLegacyArchive } = require(appRoot + '/lib/util/backup-legacy');
const { mergeRight } = require('ramda');
const { PartialPipe } = require(appRoot + '/lib/util/stream');


// The below function is only used in these tests. It's moved from erstwhile lib/task/fs.js
// in order to create archives to do the below roundtrip tests with, as we will still support
// *reading* the legacy archive format for some time, but in order to test reading it we will
// need to generate test backup files.
//
// Given a directory containing files, a path to a tmpfile, and keyinfo data,
// encrypts and zips the files into that tmpfile location, along with decryption
// keyinfo.
const encryptToArchive = (directory, tmpFilePath, keys) => {
  const outStream = createWriteStream(tmpFilePath);
  const zipStream = archiver('zip', { zlib: { level: -1 } });

  // create a cipher-generator for use below.
  const [ localkey, cipherer ] = generateLocalCipherer(keys);
  const local = { key: localkey, ivs: {} };

  // call up all files in the directory.
  return promisify(readdir)(directory).then((files) => new Promise((resolve, reject) => {
    PartialPipe.of(zipStream, outStream).pipeline(reject);

    // stream each file into the zip, encrypting on the way in. clean up each
    // plaintext file as soon as we're done with them.
    // TODO: copypasted for now to lib/resources/backup
    for (const file of files) {
      const filePath = join(directory, file);
      const [ iv, cipher ] = cipherer();
      local.ivs[basename(file)] = iv.toString('base64');

      const readStream = createReadStream(filePath);
      zipStream.append(PartialPipe.of(readStream, cipher).pipeline(reject), { name: file });
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


describe('legacy backups', () => {
  describe('encrypted archives', () => {
    // helper that creates a tmpdir, drops some test files into it, generates a
    // keyset with the given passphrase and runs the encryption to a tmpfile,
    // returning the path of that tmpfile.
    const generateTestArchive = async (passphrase) => {
      const dirpath = await promisify(tmp.dir)();
      const filepath = await promisify(tmp.file)();
      await promisify(writeFile)(join(dirpath, 'one'), 'test file one');
      await promisify(writeFile)(join(dirpath, 'two'), 'test file two');
      const keys = await generateManagedKey(passphrase);
      await encryptToArchive(dirpath, filepath, keys);
      return filepath;
    };

    it('should round-trip successfully', testTask(async () => {
      const zipfile = await generateTestArchive('super secure');
      const dirpath = await promisify(tmp.dir)();
      await decryptFromLegacyArchive(zipfile, dirpath, 'super secure');
      const files = await promisify(readdir)(dirpath);
      files.should.containDeep([ 'one', 'two' ]);
      (await promisify(readFile)(join(dirpath, 'one'))).toString('utf8').should.equal('test file one');
      (await promisify(readFile)(join(dirpath, 'two'))).toString('utf8').should.equal('test file two');
    }));

    it('should create archive that is immediately decryptable', async function() {
      this.timeout(30_000);

      // given
      const passphrase = 'super secure';
      const originalDir = await promisify(tmp.dir)(); // eslint-disable-line no-await-in-loop
      const zipfile = await promisify(tmp.file)(); // eslint-disable-line no-await-in-loop
      const keys = await generateManagedKey(passphrase); // eslint-disable-line no-await-in-loop
      for (let i=0; i<1000; ++i) execSync(`truncate -s 1 ${originalDir}/file-${i}`); // eslint-disable-line no-plusplus

      // when
      await encryptToArchive(originalDir, zipfile, keys); // eslint-disable-line no-await-in-loop
      // and
      const extractedDir = await promisify(tmp.dir)(); // eslint-disable-line no-await-in-loop
      await decryptFromArchive(zipfile, extractedDir, 'super secure'); // eslint-disable-line no-await-in-loop
    });

    it('should round-trip (getodk/central#1645) @slow', async function() {
      this.timeout(60_000);

      // given
      const passphrase = 'super secure';

      for (let bytes=0; bytes<64; ++bytes) { // eslint-disable-line no-plusplus
        // given
        const originalDir = await promisify(tmp.dir)(); // eslint-disable-line no-await-in-loop
        const zipfile = await promisify(tmp.file)(); // eslint-disable-line no-await-in-loop
        const keys = await generateManagedKey(passphrase); // eslint-disable-line no-await-in-loop
        execSync(`truncate -s ${bytes} ${originalDir}/file-1`);
        execSync(`truncate -s        1 ${originalDir}/file-2`);
        const originalSizes = fileSizes(originalDir); // eslint-disable-line no-use-before-define

        // when
        await encryptToArchive(originalDir, zipfile, keys); // eslint-disable-line no-await-in-loop
        // and
        const extractedDir = await promisify(tmp.dir)(); // eslint-disable-line no-await-in-loop
        await decryptFromLegacyArchive(zipfile, extractedDir, 'super secure'); // eslint-disable-line no-await-in-loop

        // then
        assert.deepEqual(fileSizes(extractedDir), originalSizes); // eslint-disable-line no-use-before-define
      }
    });

    it('should fail gracefully given an incorrect passphrase', testTask(async () => {
      const zipfile = await generateTestArchive('super secure');
      const dirpath = await promisify(tmp.dir)();
      await decryptFromLegacyArchive(zipfile, dirpath, 'wrong').should.be.rejected();
    }));

    it('should fail gracefully given a random file', testTask(async () => {
      const dirpath = await promisify(tmp.dir)();
      const filepath = await promisify(tmp.file)();
      await promisify(writeFile)(filepath, 'test file one');
      await decryptFromLegacyArchive(filepath, dirpath).should.be.rejected();
    }));

    it('should fail gracefully given a random archive', testTask(() => new Promise((resolve) => {
      tmp.dir((_, dirpath) =>
        // eslint-disable-next-line no-shadow
        tmp.file((_, filepath) => {
          const archive = archiver('zip', { zlib: { level: -1 } });

          archive.on('end', () => setTimeout((() =>
            decryptFromLegacyArchive(filepath, dirpath)
              .should.be.rejected()
              .then(resolve))
          ), 5); // eslint-disable-line function-paren-newline

          archive.pipe(createWriteStream(filepath));
          archive.append('some file', { name: 'file.txt' });
          archive.finalize();
        }));
    })));

  });
});

function fileSizes(dir) {
  return Object.fromEntries(
    readdirSync(dir)
      .map(f => [ f, statSync(`${dir}/${f}`).size ]),
  );
}
