const appRoot = require('app-root-path');
const { promisify } = require('util');
const { stat, readdir, readFile, writeFile, createWriteStream } = require('fs');
const { join } = require('path');
const should = require('should');
const tmp = require('tmp');
const archiver = require('archiver');
const { testTask } = require('../setup');
const { generateKeypair } = require(appRoot + '/lib/util/crypto');
const { tmpdir, tmpfile, encryptToArchive, decryptFromArchive } = require(appRoot + '/lib/task/fs');

describe('task: fs', () => {
  describe('tmpdir/file', () => {
    it('should create a temporary directory', testTask(() =>
      tmpdir()
        .then(([ path ]) => promisify(stat)(path)
          .then((dirstat) => dirstat.isDirectory().should.equal(true)))));

    it('should clean up the temporary directory', testTask(() =>
      tmpdir()
        .then(([ path, rm ]) => {
          rm();
          return promisify(stat)(path).should.be.rejected();
        })));

    it('should make a temporary file', testTask(() =>
      tmpfile()
        .then((path) => promisify(stat)(path)
          .then((filestat) => filestat.isFile().should.equal(true)))));
  });

  describe('encrypted archives', () => {
    // helper that creates a tmpdir, drops some test files into it, generates a
    // keyset with the given passphrase and runs the encryption to a tmpfile,
    // returning the path of that tmpfile.
    const generateTestArchive = async (passphrase) => {
      const dirpath = await promisify(tmp.dir)();
      const filepath = await promisify(tmp.file)();
      await promisify(writeFile)(join(dirpath, 'one'), 'test file one');
      await promisify(writeFile)(join(dirpath, 'two'), 'test file two');
      const keys = await generateKeypair(passphrase);
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
        tmp.file((_, filepath) => {
          const archive = archiver('zip', { zlib: { level: 9 } });

          archive.on('end', () => setTimeout((() =>
            decryptFromArchive(filepath, dirpath)
              .should.be.rejected()
              .then(resolve))
          ), 5);

          archive.pipe(createWriteStream(filepath));
          archive.append('some file', { name: 'file.txt' });
          archive.finalize();
        })))));

    // TODO: there are more failure cases that the code covers but the tests do not.
    // but they get increasingly elaborate to fake and increasingly improbable in
    // reality.
  });
});

