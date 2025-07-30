// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// NOTE this is the equivalent of `instrument.js` in Sentry documentation.
//
// > You need to require or import the instrument.js file before requiring any
// > other modules in your application. This is necessary to ensure that Sentry
// > can automatically instrument all modules in your application
//
// See: https://docs.sentry.io/platforms/javascript/guides/express/install/commonjs/
//
// NOTE avoid require() in this file where possible:
//
// > Any package that is required/imported before Sentry is initialized may not
// > be correctly auto-instrumented.
//
// See: https://github.com/getsentry/sentry-docs/blob/09e515bbdf1fc4d2372c4cf5c764cf18620ebf22/platform-includes/migration/javascript-v8/important-changes/javascript.express.mdx#L45
//
// Despite this, the `config` module must still be required first.

const { inspect } = require('node:util');

// Endpoints where query strings are sensitive and should be removed
const sensitiveEndpoints = [
  ['GET', '/users[^/]'], // ?q=<part of name or email>
  ['GET', '/projects/([^/]*)/forms/([^/]*)/submissions.csv'], // ?key=passphrase for managed encryption
  ['GET', '/projects/([^/]*)/forms/([^/]*)/draft/submissions.csv'], // ?key=passphrase for managed encryption
  ['GET', '/projects/([^/]*)/formList'], // ?st=token for enketo public link access (showing form)
  ['HEAD', '/projects/([^/]*)/formList'], // ?st=token for enketo public link access (showing form)
  ['POST', '/projects/([^/]*)/submission'], // ?st=token for enketo public link access (submitting)
];

const isSensitiveEndpoint = (request) => {
  for (const [method, endpoint] of sensitiveEndpoints) {
    if (request.method === method && request.url.match(endpoint)) {
      return true;
    }
  }
  return false;
};

const filterTokenFromUrl = (url) => {
  // remove user token from any URL
  if (url.match('/v1/key/(.*?)')) {
    return url.replace(/v1\/key\/([^/]*)/, 'v1/key/[FILTERED]');
  }

  // remove draft token from any URL
  if (url.match('/v1/test/(.*?)')) {
    return url.replace(/v1\/test\/([^/]*)/, 'v1/test/[FILTERED]');
  }

  // return original URL if there are no tokens
  return url;
};

const sanitizeEventRequest = (event) => {
  /* eslint-disable no-param-reassign */
  if (event.request) {

    // clear out all cookie values
    if (event.request.headers && event.request.headers.cookie) {
      const cookies = event.request.headers.cookie.split('; ')
        .map((cookie) => cookie.slice(0, cookie.indexOf('=')))
        .join(', ');

      event.request.headers.cookie = cookies;
    }

    // clear out cookie values not stored in request header
    if (event.request.cookies)
      event.request.cookies = null;

    // clear out Authorization header
    if (event.request.headers && event.request.headers.authorization)
      event.request.headers.authorization = null;

    // clear out referer header (from enketo submission, can have ?st=token in url)
    if (event.request.headers && event.request.headers.referer)
      event.request.headers.referer = null;

    // clear out x-action-notes
    if (event.request.headers && event.request.headers['x-action-notes'])
      event.request.headers['x-action-notes'] = null;

    // clear out request body data for all endpoints
    if (event.request.data)
      event.request.data = null;

    // remove sensitive info from URL via query string or path
    if (event.request.url) {
      // handle endpoints that might expose sensitive data through query params
      if (isSensitiveEndpoint(event.request) && event.request.query_string) {
        // remove query string from request data and from URL
        event.request.query_string = null;
        // remove it from URL, too, otherwise Sentry will find it
        event.request.url = event.request.url.split('?')[0]; // eslint-disable-line prefer-destructuring
      }

      // filter out access tokens embedded in URLs
      event.request.url = filterTokenFromUrl(event.request.url);
    }

  }

  /* eslint-enable no-param-reassign */

  return event;
};

let _instance;
const getInstance = () => {
  if (!_instance) throw new Error('Sentry has not been initialised.');
  return _instance;
};

const _init = (config) => {
  if (!config || !config.key || !config.project || !config.orgSubdomain) {
    // return a noop object that returns the hooks but does nothing.
    const noop = () => {};
    return {
      getCurrentScope: () => ({ setExtra: noop }),
      captureException(err) {
        process.stderr.write('attempted to log Sentry exception in development:\n');
        process.stderr.write(inspect(err) + '\n');
      },
      setupExpressErrorHandler: noop,
      startSpan: async ({ op, name }, fn) => {
        const start = performance.now();
        try {
          return await fn();
        } finally {
          const duration = performance.now() - start;
          process.stderr.write('attempted to log Sentry transaction in development:\n');
          process.stderr.write(inspect({ op, name, duration }) + '\n');
        }
      },
    };
  }

  // otherwise initialize Sentry with some settings we want.
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: `https://${config.key}@${config.orgSubdomain}.ingest.sentry.io/${config.project}`,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    tracesSampleRate: Number(config.traceRate || 0),
    beforeSend(event, hint) {
      const sanitizedEvent = sanitizeEventRequest(event);

      if (sanitizedEvent.extra && sanitizedEvent.extra.startTimestamp) { // just an extra safety check. this should be always true
        sanitizedEvent.extra.duration = Date.now() - sanitizedEvent.extra.startTimestamp;
      }

      // only file the event if it is a bare exception or it is a true 500.x Problem.
      const error = hint.originalException;
      if (error == null) return sanitizedEvent; // we aren't sure why there isn't an exception; pass through.
      if ((error.isProblem !== true) || (error.httpCode === 500)) return sanitizedEvent; // throw exceptions.
      return null; // we have a user-space problem.
    }
  });

  const username = require('os').hostname();
  Sentry.setUser({ username });

  if (process.env.SENTRY_TAGS) {
    const tags = JSON.parse(process.env.SENTRY_TAGS);
    for (const [key, value] of Object.entries(tags))
      Sentry.setTag(key, value);
  }

  return Sentry;
};
const init = (config) => {
  if (_instance) throw new Error('Sentry already initialised.');
  _instance = _init(config);
  return _instance;
};

module.exports = { init, _init, getInstance, sanitizeEventRequest, isSensitiveEndpoint, filterTokenFromUrl };
