const { execSync } = require('node:child_process');
const uuid = require('uuid').v4;

describe('cli', () => {
  it('should return status code 1 if no command is issued', () => {
    let thrown = false; // pattern from test/unit/util/crypto.js
    try {
      // eslint-disable-next-line no-use-before-define
      cli('', { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      err.status.should.equal(1);
      thrown = true;
    }
    thrown.should.equal(true);
  });

  it('should return status code 1 if non-existent command is issued', () => {
    let thrown = false; // pattern from test/unit/util/crypto.js
    try {
      // eslint-disable-next-line no-use-before-define
      cli('user-congratulate', { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      err.status.should.equal(1);
      thrown = true;
    }
    thrown.should.equal(true);
  });

  describe('command: user-create', () => {
    it('should return status code 0 and user details on success', () => {
      // eslint-disable-next-line no-use-before-define
      const email = randomEmail();

      // eslint-disable-next-line no-use-before-define
      const [, , js] = cli(`--email ${email} user-create`, { input: 'strong-password-101' })
        .match(/^([^{]*)(.*)$/ms);

      js.should.match(new RegExp(`email: '${email}',`));
      js.should.not.match(/password/);
    });
  });
});

function cli(argString, opts) {
  return execSync(
    'node lib/bin/cli.js ' + argString,
    { encoding: 'utf-8', ...opts },
  );
}

function randomEmail() {
  return uuid() + '@example.com';
}
