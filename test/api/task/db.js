const appRoot = require('app-root-path');
const { promisify } = require('util');
const { readdir } = require('fs');
const should = require('should');
const tmp = require('tmp');
const { testTask } = require('../setup');
const { pgdump } = require(appRoot + '/lib/task/db');

describe('task: db', () => {
  describe('pgdump', () => {
    it('perform a database dump into the given directory', testTask(() =>
      promisify(tmp.dir)()
        .then((dir) => pgdump(dir, 'test')
          .then(() => promisify(readdir)(dir))
          .then((files) => {
            files.length.should.be.greaterThan(0);
            files.includes('toc.dat').should.equal(true);
          }))));
  });
});

