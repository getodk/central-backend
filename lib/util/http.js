// Helper functions that relate to the HTTP/service layer of the application.

const { inspect } = require('util');
const { isBlank } = require('./util');
const Problem = require('../problem');
const Option = require('../reused/option');
const { reject } = require('../reused/promise');

// Standard simple serializer for object output.
const serialize = (obj) => {
  if (typeof obj.forApi === 'function')
    return obj.forApi();
  else if (Array.isArray(obj))
    return obj.map(serialize);

  return JSON.stringify(obj);
};

// A simple endpoint wrapper to reduce significant boilerplate.
// Any service that uses this wrapper simply needs to return one of:
// * A Problem to be returned to the user, or
// * A FutureQuery that will be executed, after which the below applies:
// * A Promise that may resolve into either a serializable object on success,
//   or else a Problem to be returned to the user.
//   * If precisely null is returned, a 404 not found is returned to the user.
const endpoint = (f) => (request, response, next) => {
  // We may have to close several Promises/FutureQueries, etc, so we handle the
  // result pseudo-recursively.
  const finalize = (maybeResult) => {
    const result = Option.of(maybeResult).orElse(Problem.internal.unknown());

    if (result.isExplicitPromise === true)
      return result.point().then(finalize, next);

    if (result.then != null)
      return result.then(finalize, next);

    if (result.isProblem === true)
      return next(result);

    if (!response.hasHeader('Content-Type'))
      response.type('json');
    response.status(200).send(serialize(result));
  };

  finalize(f(request, response));
};

// Given a error thrown upstream that is of our own internal format, this
// handler does the necessary work to translate that error into an HTTP error
// and send it out.
const sendError = (error, request, response) => {
  if (error.isProblem === true) {
    // we already have a publicly-consumable error object.
    response.status(error.httpCode).type('application/json').send({
      message: error.message,
      code: error.problemCode,
      details: error.problemDetails
    });
  } else if (error.type === 'entity.parse.failed') {
    // catch body-parser middleware problems.
    sendError(Problem.user.unparseable({ format: 'json', rawLength: error.body.length }), request, response);
  } else {
    const details = {};
    if (error.stack != null)
      details.stack = error.stack.split('\n').map((x) => x.trim());

    debugger; // trip debugger if attached.
    process.stderr.write(inspect(error));
    response.status(500).type('application/json').send({
      message: `Completely unhandled exception: ${error.message}`,
      details
    });
  }
};

// Strips a /v# prefix off the request path and exposes on the request object
// under the apiVersion property.
const versionParser = (request, response, next) => {
  // this code will all break when we hit version 10 a century from now.
  const match = /^\/v(\d)\//.exec(request.url);
  if (match == null) return next(Problem.user.missingApiVersion());
  request.apiVersion = Number(match[1]);
  if (request.apiVersion !== 1) return next(Problem.user.unexpectedApiVersion({ got: match[1] }));
  request.url = request.url.slice(3);
  next();
};

// Wraps a service, and injects the appropriate session information given the
// appropriate credentials. If the given credentials don't match a session, aborts
// with a 401. If no credentials are given, injects an empty session.
// TODO: probably a better home for this.
const sessionParser = ({ Session }) => (request, response, next) => {
  const authHeader = request.get('Authorization');
  if (!isBlank(authHeader) && authHeader.startsWith('Bearer ')) {
    Session.getByBearerToken(authHeader.slice(7)).point()
      .then((session) => {
        if (!session.isDefined()) return next(Problem.user.authenticationFailed());

        request.session = session.get();
        next();
      });
  } else {
    request.session = Session.none();
    next();
  }
};

const getOrElse = (orElse) => (option) => option.orElse(orElse);

// can't use option.orElse here, as constructing a reject is necessarily a rejection.
const getOrReject = (rejection) => (option) =>
  (option.isDefined() ? option.get() : reject(rejection));
const getOrNotFound = getOrReject(Problem.user.notFound());

module.exports = { serialize, endpoint, sendError, versionParser, sessionParser, getOrElse, getOrReject, getOrNotFound };

