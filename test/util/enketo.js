const appRoot = require('app-root-path');
const { call } = require('ramda');
// eslint-disable-next-line import/no-dynamic-require
const Problem = require(appRoot + '/lib/util/problem');

const _create = (prefix) => (openRosaUrl) => new Promise((resolve, reject) => {
  const state = global.enketoPreviewTest;
  global.enketoPreviewTest = null;
  const token = global.enketoToken || `${prefix}abcdefgh`;
  global.enketoToken = null;
  global.enketoReceivedUrl = null;
  const wait = global.enketoWait || call;
  global.enketoWait = null;

  wait(() => {
    if (state === 'error') {
      // pretend that Enketo has misbehaved
      reject(Problem.internal.enketoUnexpectedResponse('wrong status code'));
    } else {
      global.enketoReceivedUrl = openRosaUrl;
      resolve(token);
    }
  });
});

const edit = (openRosaUrl, domain, form, logicalId, submissionDef, attachments, token) => new Promise((resolve) => {
  global.enketoEditTest = null;
  global.enketoEditData = { openRosaUrl, domain, form, logicalId, submissionDef, attachments, token };
  resolve('https://enketo/edit/url');
});

module.exports = { create: _create('::'), createOnceToken: _create('::::'), edit };

