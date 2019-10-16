const appRoot = require('app-root-path');
const digest = require('digest-stream');
const Problem = require(appRoot + '/lib/util/problem');
const testData = require('../data/xml');

module.exports = (stream) => new Promise((resolve, reject) => {
  stream.pipe(digest('sha1', 'hex', (hash) => {
    const state = global.xlsformTest;
    global.xlsformTest = null;
    global.xlsformHash = hash;

    if (state === 'error')
      reject(Problem.user.xlsformNotValid({ error: 'Error: could not convert file', warnings: [ 'warning 1', 'warning 2' ] }));
    else if (state === 'warning')
      resolve({ xml: testData.forms.simple2, warnings: [ 'warning 1', 'warning 2' ] });
    else
      resolve({ xml: testData.forms.simple2, warnings: [] });
  }));
});

