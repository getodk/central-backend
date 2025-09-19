// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// We wrap almost all our Express resource declarations in one of the endpoint
// functions found below. These functions help deal with the possible return
// values from the business logic, performing useful tasks like resolving
// `Promise`s, managing output `Stream`s, and handling errors.
//
// There are specialized versions of endpoint for OpenRosa and OData-related
// actions.

const { inspect } = require('util');
const { pipeline } = require('stream');
const { DateTime } = require('luxon');
const { reduce } = require('ramda');
const { openRosaError } = require('../formats/openrosa');
const { odataXmlError } = require('../formats/odata');
const { noop, isPresent } = require('../util/util');
const jsonSerialize = require('../util/json-serialize');
const { redirect } = require('../util/http');
const { resolve, reject } = require('../util/promise');
const { PartialPipe } = require('../util/stream');
const Problem = require('../util/problem');


////////////////////////////////////////////////////////////////////////////////
// ENDPOINT COMMON UTILS
// we put these first to appease eslint.

const writeProblemJson = (response, error) => {
  // we already have a publicly-consumable error object.
  response.status(error.httpCode).type('application/json').send({
    message: error.message,
    code: error.problemCode,
    details: error.problemDetails
  });
};

// check if a string matches an expected mime type
const isJsonType = (x) => /(^|,)(application\/json|json)($|;|,)/i.test(x);
const isXmlType = (x) => /(^|,)(application\/(atom(svc)?\+)?xml|atom|xml)($|;|,)/i.test(x);

// determines if a request needs a transaction.
const phony = (request) => {
  if (/submissions\.csv(\.zip)?$/i.test(request.path)) return true;
  return false;
};
const isWriteRequest = (request) => !phony(request) &&
  ((request.method === 'POST') || (request.method === 'PUT') ||
  (request.method === 'PATCH') || (request.method === 'DELETE'));

// quick and dirty function to wrap plain values in a promise.
const ensurePromise = (x) => ((typeof x?.then === 'function') ? x : resolve(x));

// allows Streams, response-mutating functions, and Problems to be directly returned
// by a resource handler, and does sane thinsg with each.
const finalize = (result, request, response) => {
  // first run a function if we got one; its result is what we want.
  if (typeof result === 'function')
    return resolve(result(request, response))
      .then((x) => finalize(x, request, response));

  if (result == null) {
    // then bail out if there is no result but a response code has already been
    // set, so that 204 and 301/302 (which also have no content) passthrough.
    if (response.statusCode !== 200)
      return '';

    // (otherwise a null result is not allowed; return an internal developer error.)
    throw Problem.internal.emptyResponse();
  }

  // make sure Problems are thrown so they are caught by the reporter.
  if (result.isProblem === true)
    throw result;

  return result;
};

// extremely simple data class that agglomerates data like Instances does, so the
// preprocessors have somewhere to put their information besides mutating Request.
class Context {
  constructor(...data) { Object.assign(this, ...data); }
  with(other) { return new Context(this, other); }
}

// pulls out the data we want from the node request object. we do this as of node
// v16 both because it saves data weight and because in v16 they changed the
// request.headers property to be calculated, so we have to copy it manual.
const getRequestContext = (request) => ({
  method: request.method,
  url: request.url,
  originalUrl: request.originalUrl,
  headers: request.headers,
  length: request.length,
  body: request.body,
  params: request.params,
  query: request.query,
  files: request.files,
  cookies: request.cookies,

  apiVersion: request.apiVersion,
  fieldKey: request.fieldKey
});


////////////////////////////////////////////////////////////////////////////////
// ENDPOINT

// works in three phases:
// 1 takes a kernel of preprocessor, before, output, and error handling that comprise
//   some output format (eg standard-json, or openrosa, or odata),
// 2 takes a container, and a set of preprocessing middleware-like lambdas that
//   decorate a context that can be used by the resource handler itself,
// 3 takes the actual resource handler logic,
// and returns a function that fits the expressjs resource signature
// (request, response) etc and handles it.
//
// the reason we do all this work here rather than with express middleware is to
// be able to take all the application logic (auth checking all the way through
// response formulation) and synthesize it as a single Promise, whose fate can
// directly control the database transaction associated with the request.
//
// both the format preprocess function and the preprocessors given later are given:
// (container, context, request). context should contain all the information in
// request and its use is preferable. preprocess functions may return nothing,
// or a new Context instance to be used from thenceforth in that request; these
// results may be given directly as return values, or as a returned Promise result.
// if the returned Promise rejects, the whole request will reject with that error.
//
// the before handler is meant to allow some formats to always do some work on
// the Response, like setting protocol-related headers. it is the last thing that
// runs before the actual resource is called. its return value is ignored.
//
// the resource result is fed through finalize for refinement (see comments above),
// then given to the output handler, which must always be declared. at that point,
// it is guaranteed to either be final response data, or else a Stream. its job
// is to actually put this data on the wire.
//
// finally, the error handler is called as the rejection handler for the entire
// Promise chain, meaning it is called for any failure within this entire process.
// its job is to put that error on the wire in a way that suits its format (eg the
// openrosa format wraps in XML while the default format does JSON).

const endpointBase = ({ preprocessor = noop, before = noop, resultWriter, errorWriter }) => (container, preprocessors = []) => (resource) => (request, response, next) => {
  // an awkward piece of syntax, but the goal is to keep logic flowing top to bottom.
  const maybeTransact = isWriteRequest(request)
    ? (cb) => container.transacting(cb)
    : (cb) => cb(container);

  // we return the promise mostly so the unit tests and other consumers can access
  // it; express itself ignores this return value completely, and bases completion
  // on the state of the Response object.
  return maybeTransact((localContainer) =>
    // first, obtain a request promise chain that strings all our preprocessors in order.
    reduce(
      (chain, f) => chain.then((context) =>
        ensurePromise(f(localContainer, context, request)).then((result) => result || context)),
      resolve(new Context(getRequestContext(request))),
      [ preprocessor ].concat(preprocessors)
    )

      // then, unconditionally run our before handler for the given request type.
      // (the before handler does not have the opportunity to abort, or to modify context)
      .then((context) => { before(response); return context; })

      // and now run our actual resource handler with the given container and context:
      .then((context) => resource(localContainer.with({ context }), context, request, response))
      .then((result) => finalize(result, request, response)))

  // n.b. the following happen /outside/ the transaction injection! this is so we
  // don't respond before commit, and can catch without preventing the transaction
  // rollback.

  // assuming all goes well, run our result writer to actually write an output.
    .then((result) => { resultWriter(result, request, response, next); })

  // and if not, run our error handler to write the error. if it is an internal
  // error we rethrow it so that the sentry handler in the standard node error
  // infrastructure picks it up for output.
  //
    .catch((err) => {
      // perform interrupt redirects.
      if (redirect.isRedirect(err))
        response.redirect(err.code, err.url);
      else if ((err != null) && ((err.isProblem !== true) || (err.httpCode === 500)))
        next(err);
      else
        errorWriter(err, request, response);
    });
};


////////////////////////////////////////////////////////////////////////////////
// ENDPOINT FORMAT SPECIALIZATIONS

const streamErrorHandler = (response) => err => {
  if (err.isProblem && !response.headersSent && isJsonType(response.get('Content-Type'))) {
    writeProblemJson(response, err);
  } else {
    response.addTrailers({ Status: 'Error' }); // TODO: improve response content.
  }
};
const pipelineResult = (result, response, next) => {
  if (result instanceof PartialPipe) {
    result.streams.at(-1).on('error', streamErrorHandler(response));
    result.with(response).pipeline((err) => next?.(err));
    return true;
  } else if (result.pipe != null) {
    result.on('error', streamErrorHandler(response));
    pipeline(result, response, (err) => err && next?.(err));
    return true;
  }
  return false;
};

const defaultResultWriter = (result, request, response, next) => {
  if (!response.hasHeader('Content-Type')) response.type('json');

  if (pipelineResult(result, response, next)) {
    // handled
  } else if (isJsonType(response.getHeader('Content-Type'))) {
    response.send(jsonSerialize(result));
  } else {
    response.send(result);
  }
};

const plainResultWriter = (result, request, response, next) => {
  // Content type and body are passed through untouched, so it's up to
  // the user of this to get those correct.
  if (pipelineResult(result, response, next)) {
    // handled
  } else {
    response.send(result);
  }
};

// generic handler; sometimes invoked directly, sometimes as a fallback. given a
// error thrown upstream that is of our own internal format, this handler does
// the necessary work to translate that error into an HTTP error and send it out.
const defaultErrorWriter = (error, request, response) => {
  if (error instanceof URIError && error.statusCode === 400 && error.status === 400) {
    // Although there's no way to check definitively, this looks like an
    // internal error from express caused by decodeURIComponent failing.
    return defaultErrorWriter(Problem.user.notFound(), request, response);
  }

  if (error?.isProblem === true) {
    writeProblemJson(response, error);
  } else {
    debugger; // trip debugger if attached.
    process.stderr.write(inspect(error) + '\n');
    response.status(500).type('application/json').send({
      message: 'Internal Server Error',
    });
  }
};

const defaultEndpoint = endpointBase({
  resultWriter: defaultResultWriter,
  errorWriter: defaultErrorWriter
});

const plainEndpoint = endpointBase({
  resultWriter: plainResultWriter,
  errorWriter: defaultErrorWriter
});

const htmlEndpoint = endpointBase({
  resultWriter: (result, request, response) => {
    response.type('text/html');
    response.send(result);
  },
  errorWriter: (error, request, response) => {
    response.type('text/html');
    response.status(500);
    response.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>ODK Central</title>
        </head>
        <body>
          <h1>Error!</h1>
          <div id="error-message"><pre>An unknown error occurred on the server.</pre></div>
          <div><a href="/">Go home</a></div>
        </body>
      </html>
    `);
  },
});


////////////////////////////////////////
// OPENROSA

const openRosaPreprocessor = (_, context) => {
  // pedantry checks; reject if the protocol is not respected.
  const header = context.headers['x-openrosa-version'];
  if (header !== '1.0')
    return reject(Problem.user.invalidHeader({ field: 'X-OpenRosa-Version', value: header }));

  // we no longer check for Date, since Collect returns date strings with intl
  // localized text and it's too crazy to contemplate actual checking.
};

const openRosaBefore = (response) => {
  response.setHeader('Content-Language', 'en');
  response.setHeader('X-OpenRosa-Version', '1.0');
  response.setHeader('X-OpenRosa-Accept-Content-Length', '100' + '000' + '000'); // eslint-disable-line no-useless-concat
  response.setHeader('Date', DateTime.local().toHTTP());
};

// TODO: this outputter is not stream-capable, but we currently don't have any
// streaming openRosa responses. if we do someday, we'll have to code a fallback
// to a common streaming handler.
const openRosaResultWriter = (result, _, response) => {
  response.type('text/xml').status(result.code).send(result.body);
};

const openRosaErrorWriter = (error, request, response) => {
  if ((error == null) || (error.isProblem !== true))
    // if something really unexpected happened, use the standard sendError routine.
    defaultErrorWriter(error, request, response);
  else
    response.type('text/xml').status(error.httpCode).send(openRosaError(error.message)); // TODO: include more of the error detail.
};

// combine the above into the actual endpoint.
const openRosaEndpoint = endpointBase({
  preprocessor: openRosaPreprocessor,
  before: openRosaBefore,
  resultWriter: openRosaResultWriter,
  errorWriter: openRosaErrorWriter
});


////////////////////////////////////////
// ODATA

// various supported odata constants:
const supportedParams = [ '$format', '$count', '$skip', '$top', '$filter', '$wkt', '$expand', '$select', '$skiptoken', '$orderby', '$search' ];
const supportedFormats = {
  json: [ 'application/json', 'json' ],
  xml: [ 'application/xml', 'atom' ]
};

// does some filtering on odata requests to reject protocol violations/enforce
// the correct request/response formats.
const odataPreprocessor = (format) => (_, context) => {
  // check whether our response should be JSON or ATOM/XML (section 7/section 8.2.1).
  // and $format takes precedence over Accepts (section 11.2.10).
  const { accept } = context.headers;
  const { $format } = context.query;
  const isJson = isPresent($format) ? isJsonType($format) : isJsonType(accept);
  const isXml = isPresent($format) ? isXmlType($format) : isXmlType(accept);
  if ((isJson && (format === 'xml')) || (isXml && (format === 'json')))
    return reject(Problem.user.unacceptableFormat({ allowed: supportedFormats[format], got: ($format || accept) }));

  // if the client is requesting a lesser OData-MaxVersion reject (section 8.2.7).
  const maxVersion = context.headers['odata-maxversion'];
  if ((maxVersion != null) && (parseFloat(maxVersion) < 4.0))
    return reject(Problem.user.notFound());

  // if the client is requesting functionality we do not support, reject (section 11.2.1/9.3.1).
  for (const key of Object.keys(context.query))
    if (supportedParams.indexOf(key) < 0)
      return reject(Problem.internal.notImplemented({ feature: key }));

  if (context.query.$expand && context.query.$expand !== '*')
    return reject(Problem.internal.unsupportedODataExpandExpression({ text: context.query.$expand }));

  if (context.query.$expand && context.query.$select)
    return reject(Problem.internal.unsupportedODataSelectExpand());
};

// respond with the appropriate OData version (section 8.1.5).
const odataBefore = (response) => { response.setHeader('OData-Version', '4.0'); };

const odataJsonWriter = (result, request, response, next) => {
  if (!response.hasHeader('Content-Type')) response.type('json');

  if (pipelineResult(result, response, next)) {
    // handled
  } else {
    // OData JSON endpoints craft JSON by hand
    response.send(result);
  }
};

// for xml, error in xml.
const odataXmlErrorWriter = (error, request, response) => {
  if ((error == null) || (error.isProblem !== true))
    // if something really unexpected happened, use the standard sendError routine.
    return defaultErrorWriter(error, request, response);
  else
    response.type('text/xml').status(error.httpCode).send(odataXmlError(error));
};

// finally, the actual endpoint definition for odata endpoints:
const odataJsonEndpoint = endpointBase({
  preprocessor: odataPreprocessor('json'),
  before: odataBefore,
  resultWriter: odataJsonWriter,
  errorWriter: defaultErrorWriter
});
const odataXmlEndpoint = endpointBase({
  preprocessor: odataPreprocessor('xml'),
  before: odataBefore,
  resultWriter: defaultResultWriter,
  errorWriter: odataXmlErrorWriter
});


////////////////////////////////////////////////////////////////////////////////
// FINAL ENDPOINT CONSTRUCTION (with formats)

const builder = (container, preprocessors) => {
  const result = defaultEndpoint(container, preprocessors);
  result.plain = plainEndpoint(container, preprocessors);
  result.html = htmlEndpoint(container, preprocessors);
  result.openRosa = openRosaEndpoint(container, preprocessors);
  result.odata = {
    json: odataJsonEndpoint(container, preprocessors),
    xml: odataXmlEndpoint(container, preprocessors)
  };
  return result;
};


module.exports = {
  // exported for actual use in the general codebase:
  builder, defaultErrorWriter,

  // exported for testing purposes only:
  Context, endpointBase,
  defaultResultWriter,
  openRosaPreprocessor, openRosaBefore, openRosaResultWriter, openRosaErrorWriter,
  odataPreprocessor, odataBefore
};

