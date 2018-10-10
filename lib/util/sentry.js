const { isBlank } = require('./util');

const init = (config) => {
  if ((config == null) || isBlank(config.key) || isBlank(config.project)) {
    // return a noop object that returns the hooks but does nothing.
    return { Handlers: {
      requestHandler() { return (request, response, next) => next(); },
      errorHandler() { return (error, request, response, next) => next(error); }
    } };
  }

  // otherwise initialize Sentry with some settings we want.
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: `https://${config.key}@sentry.io/${config.project}`,
    beforeSend(event) {
      // only file the event if it is a bare exception or it is a true 500.x Problem.
      const error = event.extra.Error;
      return ((error.isProblem !== true) || (error.httpCode === 500)) ? event : null;
    }
  });
  return Sentry;
};

module.exports = { init };

