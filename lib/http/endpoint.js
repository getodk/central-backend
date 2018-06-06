// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
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
const { DateTime } = require('luxon');
const { openRosaError } = require('../outbound/openrosa');
const { serialize } = require('../util/http');
const Problem = require('../util/problem');
const Option = require('../util/option');


// This helper is used by all the endpoint wrappers below to repeatedly
// resolve intermediate result products until a final result is achieved.
// The success and failure callbacks are appropriately called with the
// ultimate result thereof.
const finalize = (success, failure, request, response) => {
  const finalizer = (maybeResult) => {
    const result = Option.of(maybeResult).orElse(Problem.internal.emptyResponse());

    if (result.pipe != null) {
      // automatically stop a database query if the request is aborted:
      request.on('close', () => {
        if (typeof result.end === 'function')
          result.end();
      });
      return result.pipe(response);
    }

    if (result.isExplicitPromise === true)
      return result.point().then(finalizer, failure);

    if (result.then != null)
      return result.then(finalizer, failure);

    if (typeof result === 'function')
      return finalizer(result(request, response));

    if (result.isProblem === true)
      return failure(result);

    success(result);
  };

  return finalizer;
};


////////////////////////////////////////////////////////////////////////////////
// ENDPOINT

// A simple endpoint wrapper to reduce significant boilerplate.
// Any service that uses this wrapper simply needs to return one of:
// * A Problem to be returned to the user, or
// * A FutureQuery that will be executed, after which the below applies:
// * A Promise that may resolve into either a serializable object on success,
//   or else a Problem to be returned to the user.
//   * If precisely null is returned, a 404 not found is returned to the user.
const endpoint = (f) => (request, response, next) => {
  const success = (result) => {
    if (!response.hasHeader('Content-Type')) response.type('json');
    response.status(200).send(serialize(result));
  };

  finalize(success, next, request, response)(f(request, response));
};

const openRosaEndpoint = (f) => (request, response, rawNext) => {
  const next = (x) => rawNext(((x != null) && (x.isProblem === true)) ? { forOpenRosa: x } : x, request, response);

  // Even if we fail we'll want these headers so just do it here.
  response.setHeader('Content-Language', 'en');
  response.setHeader('X-OpenRosa-Version', '1.0');
  response.setHeader('X-OpenRosa-Accept-Content-Length', '20' + '000' + '000'); // eslint-disable-line no-useless-concat
  response.setHeader('Date', DateTime.local().toHTTP());
  response.type('text/xml');

  // pedantry checks; reject if the protocol is not respected.
  const header = request.headers;
  if (header['x-openrosa-version'] !== '1.0')
    return next(Problem.user.invalidHeader({ field: 'X-OpenRosa-Version', value: header['x-openrosa-version'] }));
  // ODK Collect does not actually produce RFC 850/1123-compliant dates, so we munge the
  // date a little on its behalf:
  const patchedDate = (header.date == null) ? null : header.date.replace(/GMT.*$/i, 'GMT');
  if (DateTime.fromHTTP(patchedDate).isValid !== true)
    return next(Problem.user.invalidHeader({ field: 'Date', value: header.date }));

  // we assume any OpenRosa endpoint will only be passed xml strings.
  const success = (result) => { response.status(result.code).send(result.body); };
  finalize(success, next)(f(request, response));
};


////////////////////////////////////////
// > ODATA

// tiny util to check if a string matches an expected odata format type.
const isJsonType = (x) => /(^|,)(application\/json|json)($|;|,)/i.test(x);
const isXmlType = (x) => /(^|,)(application\/(atom(svc)?\+)?xml|atom|xml)($|;|,)/i.test(x);

// various supported odata constants:
const supportedParams = [ '$format', '$count', '$skip', '$top', '$wkt' ];
const supportedFormats = {
  json: [ 'application/json', 'json' ],
  xml: [ 'application/xml', 'atom' ]
};

// preflight checks and request decoration for odata requests.
const odataEndpoint = (f, format) => {
  // instantiate a basic endpoint for response handling; we really only care about
  // filtering requests out pre-resource.
  const inner = endpoint(f);

  return (request, response, next) => {
    // check whether our response should be JSON or ATOM/XML (section 7/section 8.2.1).
    // and $format takes precedence over Accepts (section 11.2.10).
    const { $format, accept } = request.headers;
    const isJson = isJsonType($format) || isJsonType(accept);
    const isXml = isXmlType($format) || isXmlType(accept);
    if ((isJson && (format === 'xml')) || (isXml && (format === 'json')))
      return next(Problem.user.unacceptableFormat({ allowed: supportedFormats[format], got: ($format || accept) }));

    // if the client is requesting a lesser OData-MaxVersion reject (section 8.2.7).
    const maxVersion = request.headers['odata-maxversion'];
    if ((maxVersion != null) && (parseFloat(maxVersion) < 4.0))
      return next(Problem.user.notFound());

    // if the client is requesting functionality we do not support, reject (section 11.2.1/9.3.1).
    for (const key of Object.keys(request.query))
      if (supportedParams.indexOf(key) < 0)
        return next(Problem.internal.notImplemented({ feature: key }));

    // respond with the appropriate OData version (section 8.1.5).
    response.setHeader('OData-Version', '4.0');

    // fallthrough to default handling.
    inner(request, response, next);
  };
};

// decorate some easy helpers.
odataEndpoint.xml = (f) => odataEndpoint(f, 'xml');
odataEndpoint.json = (f) => odataEndpoint(f, 'json');


////////////////////////////////////////////////////////////////////////////////
// ERROR HANDLING
// Given a error thrown upstream that is of our own internal format, this
// handler does the necessary work to translate that error into an HTTP error
// and send it out.
const sendError = (error, request, response) => {
  if (Object.prototype.hasOwnProperty.call(error, 'forOpenRosa')) {
    const problem = error.forOpenRosa;
    response
      .status(problem.httpCode)
      .send(openRosaError(problem.message)); // TODO: include more of the error detail.
  } else if (error.isProblem === true) {
    if ((error.httpCode === 403) && (request.get('user-agent').match(/tableau/i))) {
      // HACK: Tableau rigidly follows the HTTP spec for basic auth; it first makes the
      // request without credentials even though it has them, and it will retry with
      // Basic auth iff you respond with 401 and a WWW-Authenticate header prescribing
      // a Basic auth retry. but Basic auth is the last-resort option we provide only for
      // consumers who cannot OAuth or are doing quick tasks, so we absolutely do not want
      // to respond to every insufficient privileges request with "canonically use HTTP
      // Basic please." and in accordance with most of the modern web, we return 403 instead
      // of 401 if you /are/ authenticated but don't have enough rights. so we intercept and
      // transform this response only for Tableau.
      response
        .status(401)
        .set('WWW-Authenticate', 'Basic charset="UTF-8"')
        .type('application/json')
        .send({ message: 'The authenticated actor does not have rights to perform that action.' });
    } else {
      // we already have a publicly-consumable error object.
      response.status(error.httpCode).type('application/json').send({
        message: error.message,
        code: error.problemCode,
        details: error.problemDetails
      });
    }
  } else if (error.type === 'entity.parse.failed') {
    // catch body-parser middleware problems. we only ask it to parse JSOn, which
    // isn't part of OpenRosa, so we can assume a plain JSON response.
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


module.exports = { finalize, endpoint, openRosaEndpoint, odataEndpoint, sendError };

