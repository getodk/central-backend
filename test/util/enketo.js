const appRoot = require('app-root-path');
const Problem = require(appRoot + '/lib/util/problem');

module.exports = {
  preview: (openRosaUrl, xmlFormId, response) => new Promise((resolve, reject) => {
    const state = global.enketoPreviewTest;
    global.enketoPreviewTest = null;

    if (state === 'error') {
      // pretend that Enketo has misbehaved
      reject(Problem.internal.enketoUnexpectedResponse('wrong status code'));
    } else {
      response.statusCode = 201;
      resolve({ 'preview_url': 'http://enke.to/preview/::abcdefgh','code': 201 });
    }
  })
};

