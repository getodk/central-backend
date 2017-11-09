// Helper functions that relate to the HTTP/service layer of the application.

const { inspect } = require('util');
const { isBlank } = require('./util');
const Problem = require('../problem');
const Option = require('../reused/option');

// Standard simple serializer for object output.
const serialize = (obj) => {
  if (typeof obj.forSerialize === 'function')
    return obj.forSerialize();
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
  const result = Option.of(f(request, response)).orElse(Problem.internal.unknown());

  if (result.isProblem === true)
    return next(result);

  // generate a success handler to be used for both branches below.
  const finalize = (asyncResult) => {
    if (asyncResult === null)
      return next(Problem.user.notFound());

    if (asyncResult.isProblem === true)
      return next(asyncResult);

    if (!response.hasHeader('Content-Type'))
      response.type('json');
    response.status(200).send(serialize(asyncResult));
  };

  if (result.isFutureQuery === true)
    result.end().then(finalize, next);
  else
    result.then(finalize, next);
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

// Wraps a service, and injects the appropriate session information given the
// appropriate credentials. If the given credentials don't match a session, aborts
// with a 401. If no credentials are given, injects an empty session.
// TODO: probably a better home for this.
const sessionParser = ({ Session, sessions }) => (request, response, next) => {
  const authHeader = request.get('Authorization');
  if (!isBlank(authHeader) && authHeader.startsWith('Bearer ')) {
    sessions.getByBearerToken(authHeader.slice(7)).then((session) => {
      if (!session.isDefined()) return next(Problem.user.authenticationFailed());

      request.session = session.get();
      next();
    }).end();
  } else {
    request.session = Session.none();
    next();
  }
};

module.exports = { serialize, endpoint, sendError, sessionParser, getOr404 };

