const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const appRoot = require('app-root-path');
const { promisify } = require('util');
const { readdir, readdirSync, readFile, statSync, writeFile, createWriteStream } = require('fs');
const { join } = require('path');
const tmp = require('tmp');
const archiver = require('archiver');
const { testTask } = require('../setup');
const { generateManagedKey } = require(appRoot + '/lib/util/crypto');
const { encryptToArchive, decryptFromArchive } = require(appRoot + '/lib/task/fs');

describe('task: fs', () => {
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
      await decryptFromArchive(zipfile, dirpath, 'super secure');
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
        await decryptFromArchive(zipfile, extractedDir, 'super secure'); // eslint-disable-line no-await-in-loop

        // then
        assert.deepEqual(fileSizes(extractedDir), originalSizes); // eslint-disable-line no-use-before-define
      }
    });

    it('should fail gracefully given an incorrect passphrase', testTask(async () => {
      const zipfile = await generateTestArchive('super secure');
      const dirpath = await promisify(tmp.dir)();
      await decryptFromArchive(zipfile, dirpath, 'wrong').should.be.rejected();
    }));

    it('should fail gracefully given a random file', testTask(async () => {
      const dirpath = await promisify(tmp.dir)();
      const filepath = await promisify(tmp.file)();
      await promisify(writeFile)(filepath, 'test file one');
      await decryptFromArchive(filepath, dirpath).should.be.rejected();
    }));

    it('should fail gracefully given a random archive', testTask(() => new Promise((resolve) => {
      tmp.dir((_, dirpath) =>
        // eslint-disable-next-line no-shadow
        tmp.file((_, filepath) => {
          const archive = archiver('zip', { zlib: { level: -1 } });

          archive.on('end', () => setTimeout((() =>
            decryptFromArchive(filepath, dirpath)
              .should.be.rejected()
              .then(resolve))
          ), 5); // eslint-disable-line function-paren-newline

          archive.pipe(createWriteStream(filepath));
          archive.append('some file', { name: 'file.txt' });
          archive.finalize();
        }));
    })));

    // TODO: there are more failure cases that the code covers but the tests do not.
    // but they get increasingly elaborate to fake and increasingly improbable in
    // reality.
  });
});

function fileSizes(dir) {
  return Object.fromEntries(
    readdirSync(dir)
      .map(f => [ f, statSync(`${dir}/${f}`).size ]),
  );
}
