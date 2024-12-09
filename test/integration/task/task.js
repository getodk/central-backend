const appRoot = require('app-root-path');
const { testTask } = require('../setup');
const { sql } = require('slonik');
const { writeFile, symlink } = require('fs');
const { join } = require('path');
const { exec } = require('child_process');
const { identity } = require('ramda');
const { auditing, emailing } = require(appRoot + '/lib/task/task');
const Problem = require(appRoot + '/lib/util/problem');
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
  const runScript = (script) => new Promise((resolve) => {
    tmp.dir((_, dirpath) => {
      const scriptPath = join(dirpath, 'script.js');
      writeFile(scriptPath, script, () =>
        symlink(join(appRoot.toString(), 'node_modules'), join(dirpath, 'node_modules'), () =>
          symlink(join(appRoot.toString(), 'lib'), join(dirpath, 'lib'), () =>
            exec(`${process.argv0} ${scriptPath}`, (error, stdout, stderr) =>
              resolve([error, stdout, stderr])))));
    });
  });

  it('should print success json to stdout', () => runScript(success)
    .then(([ , stdout ]) => stdout.should.equal(`{"test":"result"}\n`)));

  it('should print failure details to stderr and exit nonzero', () => runScript(failure)
    .then(([ error, , stderr ]) => {
      error.code.should.equal(1);
      stderr.should.containEql('Problem [Error]: The resource returned no data.');
    }));
});

describe('task: auditing', () => {
  context('on task success', () => {
    it('should log', testTask(({ all }) =>
      auditing('testAction', Promise.resolve({ key: 'value' }))
        .then(() => all(sql`select * from audits`))
        .then((audits) => {
          audits.length.should.equal(1);
          audits[0].action.should.equal('testAction');
          audits[0].details.should.eql({ success: true, key: 'value' });
        })));

    it('should fault but passthrough on log failure', testTask(({ Audits }) => {
      // hijack Audit.log to crash. new container is made for each test so we don't have
      // to restore a working one.
      // eslint-disable-next-line no-param-reassign
      Audits.log = () => Promise.reject(new Error());
      return auditing('testAction', Promise.resolve(true))
        .then((result) => {
          // too difficult to test stderr output.
          process.exitCode.should.equal(1);
          result.should.equal(true);
        });
    }));
  });

  context('on task failure', () => {
    it('should log', testTask(({ all }) =>
      auditing('testAction', Promise.reject(Problem.user.missingParameter({ field: 'test' })))
        .then(identity, () => all(sql`select * from audits`)
          .then((audits) => {
            audits.length.should.equal(1);
            audits[0].action.should.equal('testAction');
            audits[0].details.message.should.equal('Required parameter test missing.');
            audits[0].details.code.should.equal(400.2);
          }))));

    it('should fault but passthrough on log failure', testTask(({ Audits }) => {
      // ditto above.
      // eslint-disable-next-line no-param-reassign
      Audits.log = () => Promise.reject(Problem.user.missingParameter({ field: 'test' }));
      return auditing('testAction', Promise.reject(new Error('uhoh')))
        .then(identity, (result) => {
          // too difficult to test stderr output.
          process.exitCode.should.equal(1);
          result.should.be.instanceOf(Error);
          result.message.should.equal('uhoh');
        });
    }));
  });
});

describe('task: emailing', () => {
  it('should do nothing on task success', testTask(() =>
    emailing('testAction', Promise.resolve({ key: 'value' }))
      .then(() => { global.inbox.length.should.equal(0); })));

  it('should send an email on task failure', testTask(() =>
    emailing('accountReset', Promise.reject(Problem.user.missingParameter({ field: 'test' })))
      .then(identity, () => {
        const email = global.inbox.pop();
        email.to.should.eql([{ address: 'no-reply@getodk.org', name: '' }]);
        email.subject.should.equal('ODK Central account password reset');
      }).should.be.fulfilled()));
});

