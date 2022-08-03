const semver = require('semver'); // eslint-disable-line import/no-extraneous-dependencies
const pkg = require('../../package.json');

const expected = pkg.engines.node;
const actual = process.version;

if (!semver.satisfies(actual, expected)) {
  throw new Error(`Current Node.js version '${actual}' does not meet version required in package.json ('${expected}'.)`);
}
