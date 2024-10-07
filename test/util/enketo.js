// This file exports an enketo mock for testing. A test can communicate with the
// mock by getting or setting properties of global.enketo.

const appRoot = require('app-root-path');
const { call } = require('ramda');
const Problem = require(appRoot + '/lib/util/problem');
const { without } = require(appRoot + '/lib/util/util');

const defaults = {
  // Properties that can be set to change the behavior of the mock. These
  // properties are reset after each mock request.

  // If `state` is set to 'error', the mock will pretend that Enketo has
  // misbehaved and will return a rejected promise for the next call.
  state: undefined,
  // Controls the timing of the Enketo response.
  wait: call,
  // The enketoId for the create() method to return (by default, ::abcdefgh).
  enketoId: undefined,

  // Properties that the mock may update after being called. These properties
  // are how the mock communicates back to the test.

  // The number of times that the mock has been called during the test, that is,
  // the number of requests that would be sent to Enketo
  callCount: 0,
  // An object with a property for each argument passed to the create() method
  createData: undefined,
  // The OpenRosa URL that was passed to the create() method
  receivedUrl: undefined,
  // An object with a property for each argument passed to the edit() method
  editData: undefined,

  // Control whether enketo resets after a request. Set to false in tests that
  // need multiple error requests or timeouts in a row.
  autoReset: true,
};

let cancelToken = 0;

const reset = () => {
  if (global.enketo === undefined) global.enketo = { reset };
  Object.assign(global.enketo, defaults);
  cancelToken += 1;
};

// Mocks a request to Enketo.
const request = () => {
  global.enketo.callCount += 1;
  const options = { ...global.enketo };

  if (global.enketo.autoReset)
    Object.assign(global.enketo, without(['callCount'], defaults));

  return new Promise((resolve, reject) => {
    const { wait } = options;
    const tokenBeforeWait = cancelToken;
    wait(() => {
      if (cancelToken !== tokenBeforeWait)
        reject(new Error('request was canceled'));
      else if (options.state === 'error')
        reject(Problem.internal.enketoUnexpectedResponse('wrong status code'));
      else
        resolve(options);
    });
  });
};

const create = async (openRosaUrl, xmlFormId, token) => {
  const { enketoId = '::abcdefgh' } = await request();
  global.enketo.createData = { openRosaUrl, xmlFormId, token };
  global.enketo.receivedUrl = openRosaUrl;
  return { enketoId, enketoOnceId: '::::abcdefgh' };
};

const edit = async (openRosaUrl, domain, form, logicalId, submissionDef, attachments, token) => {
  await request();
  global.enketo.editData = { openRosaUrl, domain, form, logicalId, submissionDef, attachments, token };
  return 'https://enketo/edit/url';
};

module.exports = { create, edit, reset };

