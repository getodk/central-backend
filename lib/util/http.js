// Helper functions that relate to the HTTP/service layer of the application.

const { inspect } = require('util');
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
const sendError = (response, error) => {
  if (error.isProblem === true) {
    response.status(error.httpCode).type('application/json').send({
      message: error.message,
      code: error.problemCode,
      details: error.problemDetails
    });
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

module.exports = { serialize, endpoint, sendError };

