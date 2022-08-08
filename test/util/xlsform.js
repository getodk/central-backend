const appRoot = require('app-root-path');
const digest = require('digest-stream');
// eslint-disable-next-line import/no-dynamic-require
const Problem = require(appRoot + '/lib/util/problem');
const testData = require('../data/xml');

module.exports = (stream, fallback) => new Promise((resolve, reject) => {
  stream.pipe(digest('sha1', 'hex', (hash) => {
    const state = global.xlsformTest;
    global.xlsformTest = null;
    const form = global.xlsformForm;
    global.xlsformForm = null;

    global.xlsformHash = hash;
    global.xlsformFallback = fallback;

    if (state === 'error')
      reject(Problem.user.xlsformNotValid({ error: 'Error: could not convert file', warnings: [ 'warning 1', 'warning 2' ] }));
    else if (state === 'warning')
      resolve({ xml: testData.forms.simple2, warnings: [ 'warning 1', 'warning 2' ] });
    else if (form === 'itemsets')
      resolve({ xml: testData.forms.itemsets, itemsets: 'a,b,c\n1,2,3\n4,5,6', warnings: [] });
    else if (form === 'extra-itemsets')
      resolve({ xml: testData.forms.simple2, itemsets: 'a,b,c\n1,2,3\n4,5,6', warnings: [] });
    else
      resolve({ xml: testData.forms.simple2, warnings: [] });
  }));
});

