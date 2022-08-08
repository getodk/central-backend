const appRoot = require('app-root-path');
const { promisify } = require('util');
const { readdir, readFile, writeFile, createWriteStream } = require('fs');
const { join } = require('path');
const tmp = require('tmp');
const archiver = require('archiver');
const { testTask } = require('../setup');
// eslint-disable-next-line import/no-dynamic-require
const { generateManagedKey } = require(appRoot + '/lib/util/crypto');
// eslint-disable-next-line import/no-dynamic-require
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

    it('should fail gracefully given a random archive', testTask(() => new Promise((resolve) =>
      tmp.dir((_, dirpath) =>
        // eslint-disable-next-line no-shadow
        tmp.file((_, filepath) => {
          const archive = archiver('zip', { zlib: { level: 9 } });

          archive.on('end', () => setTimeout((() =>
            decryptFromArchive(filepath, dirpath)
              .should.be.rejected()
              .then(resolve))
          ), 5); // eslint-disable-line function-paren-newline

          archive.pipe(createWriteStream(filepath));
          archive.append('some file', { name: 'file.txt' });
          archive.finalize();
        })))));

    // TODO: there are more failure cases that the code covers but the tests do not.
    // but they get increasingly elaborate to fake and increasingly improbable in
    // reality.
  });
});

