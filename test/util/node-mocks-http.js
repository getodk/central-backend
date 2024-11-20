// Safe wrapper for node-mocks-http - ensure that query string parsing matches
// what is happening in production.  N.B. if express's `query parser` option is
// set, this wrapper will need to change too.
//
// See: https://expressjs.com/en/api.html#app.settings.table
// See: https://github.com/eugef/node-mocks-http/issues/299

const { EventEmitter } = require('events');
const wrapped = require('node-mocks-http');

const qs = (() => {
  try {
    // In case express has its own version of qs, try loading that first:
    return require('../../node_modules/express/node_modules/qs'); // eslint-disable-line import/extensions,import/no-unresolved
  } catch (err) {
    // Try loading the global qs.  This is not written as `require('qs')` to avoid loading of the qs module from a surprising place.
    try {
      return require('../../node_modules/qs'); // eslint-disable-line import/extensions,import/no-unresolved
    } catch (err) { // eslint-disable-line no-shadow
      // node_modules layout may change in future (e.g. using yarn with different nodeLinker config)
      throw new Error('Unexpected missing module: qs.  Please confirm node_modules directory is initialised, and dependency resolution has not changed recently.');
    }
  }
})();

const createRequest = options => {
  if (!options?.url) return wrapped.createRequest(options);

  const { search } = new URL(options.url, 'http://example.test');
  const { query } = options;

  if (!search) return wrapped.createRequest(options);

  if (query != null) throw new Error('Unsupported: .query option and query string in .url simultaneously.');

  return wrapped.createRequest({ ...options, query: qs.parse(search.substr(1)) });
};

const createResponse = options => wrapped.createResponse({ eventEmitter: EventEmitter, ...options });

module.exports = {
  createRequest,
  createResponse,
};
