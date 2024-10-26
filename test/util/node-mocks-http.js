// Safe wrapper for node-mocks-http
// See: https://github.com/eugef/node-mocks-http/issues/299

const wrapped = require('node-mocks-http');
// qs is an implicit dependency of express:
const qs = require('qs'); // eslint-disable-line import/no-extraneous-dependencies

const createRequest = options => {
  if (!options?.url) return wrapped.createRequest(options);

  const { search } = new URL(options.url, 'http://example.test');
  const { query } = options;

  if (!search) return wrapped.createRequest(options);

  if (query != null) throw new Error('Unsupported: .query option and query string in .url simultanesously.');

  return wrapped.createRequest({ ...options, query: qs.parse(search.substr(1)) });
};

module.exports = {
  createRequest,
  createResponse: wrapped.createResponse,
};
