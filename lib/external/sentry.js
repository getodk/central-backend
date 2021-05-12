const { inspect } = require('util');
const { isBlank } = require('../util/util');

const sensitiveEndpoints = [
  '/users/reset/verify',
  '/users/(.*?)/password',
  '/users',
  '/sessions',
  '/projects/(.*?)/key',
  '/projects/([^/]*)/forms/([^/]*)/submissions.csv.zip',
  '/projects/([^/]*)/forms/([^/]*)/submissions.csv',
  '/projects/([^/]*)/forms/([^/]*)/draft/submissions.csv',
  '/projects/([^/]*)/forms/([^/]*)/draft/submissions.csv.zip',
  '/config/backups/initiate',
  '/backup',
];

const init = (config) => {
  if ((config == null) || isBlank(config.key) || isBlank(config.project)) {
    // return a noop object that returns the hooks but does nothing.
    return {
      Handlers: {
        requestHandler() { return (request, response, next) => next(); },
        errorHandler() { return (error, request, response, next) => next(error); }
      },
      captureException(err) {
        process.stderr.write('attempted to log Sentry exception in development:\n');
        process.stderr.write(inspect(err));
        process.stderr.write('\n');
      }
    };
  }

  // otherwise initialize Sentry with some settings we want.
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: `https://${config.key}@sentry.io/${config.project}`,
    beforeSend(event) {
      if (event.request) {
        // clear out all cookie values
        if (event.request.headers && event.request.headers.cookie) {
          const cookies = event.request.headers.cookie.split('; ')
            .map((cookie) => cookie.slice(0, cookie.indexOf('=')))
            .join(', ');

          event.request.headers.cookie = cookies; // eslint-disable-line no-param-reassign
        }

        // clear out cookie values not stored in request header
        if (event.request.cookies)
          event.request.cookies = null; // eslint-disable-line no-param-reassign

        // clear out Authorization header
        if (event.request.headers && event.request.headers.authorization)
          event.request.headers.authorization = null; // eslint-disable-line no-param-reassign

        // clear out all request body data and query params for sensitive endpoints (logging in, etc)
        if (event.request.url) {
          for (const endpoint of sensitiveEndpoints) {
            if (event.request.url.match(endpoint)) {
              event.request.data = null; // eslint-disable-line no-param-reassign

              // remove query string from request data and from URL
              event.request.query_string = null; // eslint-disable-line no-param-reassign

              // remove it from URL, too, otherwise Sentry will find it
              event.request.url = event.request.url.split('?')[0]; // eslint-disable-line no-param-reassign, prefer-destructuring
            }
          }
        }
      }

      // remove user token from any URL
      if (event.request.url.match('/key/(.*?)')) {
        event.request.url = event.request.url.replace(/key\/([^/]*)/, 'key/[FILTERED]'); // eslint-disable-line no-param-reassign
      }

      // remove draft token from any URL
      if (event.request.url.match('/test/(.*?)')) {
        event.request.url = event.request.url.replace(/test\/([^/]*)/, 'test/[FILTERED]'); // eslint-disable-line no-param-reassign
      }

      // only file the event if it is a bare exception or it is a true 500.x Problem.
      const error = event.extra.Error;
      if (error == null) return event; // we aren't sure why there isn't an exception; pass through.
      if ((error.isProblem !== true) || (error.httpCode === 500)) return event; // throw exceptions.
      return null; // we have a user-space problem.
    }
  });
  return Sentry;
};

module.exports = { init };

