const appRoot = require('app-root-path');
const { promisify } = require('util');
const { stat } = require('fs');
const should = require('should');
const tmp = require('tmp');
const { testTask } = require('../setup');
const { tmpdir, tmpfile, encryptedArchive } = require(appRoot + '/lib/task/fs');

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
});


