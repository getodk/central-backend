// Safe wrapper for node-mocks-http - ensure that query string parsing matches
// what is happening in production.  N.B. if express's `query parser` option is
// set, this wrapper will need to change too.
//
// See: https://expressjs.com/en/api.html#app.settings.table
// See: https://github.com/eugef/node-mocks-http/issues/299

const { EventEmitter } = require('events');
const querystring = require('node:querystring');
const wrapped = require('node-mocks-http');

const createRequest = options => {
  if (!options?.url) return wrapped.createRequest(options);

  const { search } = new URL(options.url, 'http://example.test');
  const { query } = options;

  if (!search) return wrapped.createRequest(options);

  if (query != null) throw new Error('Unsupported: .query option and query string in .url simultaneously.');

  return wrapped.createRequest({ ...options, query: querystring.parse(search.substr(1)) });
};

const createResponse = options => wrapped.createResponse({ eventEmitter: EventEmitter, ...options });

module.exports = {
  createRequest,
  createResponse,
};
