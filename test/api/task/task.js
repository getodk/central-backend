const appRoot = require('app-root-path');
const should = require('should');
const { writeFile, symlink } = require('fs');
const { join } = require('path');
const { exec } = require('child_process');
const tmp = require('tmp');

describe('task: runner', () => {
  const success = `
    const { task, run } = require('./lib/task/task');
    run(Promise.resolve({ test: 'result' }));
  `;
  const failure = `
    const { task, run } = require('./lib/task/task');
    const Problem = require('./lib/util/problem');
    run(Promise.reject(Problem.internal.emptyResponse()));
  `;
  const runScript = (script) => new Promise((resolve) => tmp.dir((_, dirpath) => {
    const scriptPath = join(dirpath, 'script.js');
    writeFile(scriptPath, script, () =>
      symlink(join(appRoot.toString(), 'node_modules'), join(dirpath, 'node_modules'), () =>
        symlink(join(appRoot.toString(), 'lib'), join(dirpath, 'lib'), () =>
          exec(`${process.argv0} ${scriptPath}`, (error, stdout, stderr) =>
            resolve([ error, stdout, stderr ])))));
  }));

  it('should print success object to stdout', () => runScript(success)
    .then(([ , stdout ]) => stdout.should.equal(`'{"test":"result"}'\n`)));

  it('should print failure details to stderr and exit nonzero', () => runScript(failure)
    .then(([ error, , stderr ]) => {
      error.code.should.equal(1);
      stderr.should.match(/^\{ Error: The resource returned no data./);
    }));
});

