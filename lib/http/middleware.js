// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// we do something a tiny bit unconventional in this project: we use actual express
// middleware very very sparingly: essentially, only middleware that rewrites the
// incoming url are actual express middleware.
//
// a lot of the other things you might normally expect to find--header parsers,
// auth checkers, and so on--are split between the preprocessors.js and the
// endpoints.js files. they are not implemented as express middleware, because
// we would like for the entire requestpath to run within a single Promise context,
// so that we can manage the database transaction without awkward contortions.

const Problem = require('../util/problem');
const Option = require('../util/option');


// Strips a /v# prefix off the request path and exposes on the request object
// under the apiVersion property.
const versionParser = (request, response, next) => {
  const match = /^\/v(\d+)(\/.*)$/.exec(request.url);
  if (match == null) return next(Problem.user.missingApiVersion());
  const [ , apiVersion, resourcePath ] = match;
  request.apiVersion = Number(apiVersion);
  if (request.apiVersion !== 1) return next(Problem.user.unexpectedApiVersion({ got: apiVersion }));
  request.url = resourcePath;
  next();
};

// Similarly, we need to process fieldkey URLs and rewrite them before routing
// occurs. if found, we just rewrite and store the value on request.
//
// TODO: repetitive.
// TODO: we should probably reject as usual if multiple auth mechs are used
// at once but that seems like a corner of a corner case here?
const fieldKeyParser = (request, response, next) => {
  const match = /^\/key\/([^/]+)\//.exec(request.url);

  const prefixKey = Option.of(match).map((m) => decodeURIComponent(m[1]));
  prefixKey.ifDefined(() => { request.url = request.url.slice(match[0].length - 1); });

  const queryKey = Option.of(request.query.st);
  queryKey.ifDefined((token) => {
    delete request.query.st;
    // we modify the request url to ensure openRosa gives prefixed responses
    // per the requested token. we have to slice off the /v1.
    request.originalUrl = `/v1/key/${token.replace(/\//g, '%2F')}${request.originalUrl.slice(3)}`;
  });

  request.fieldKey = Option.of(prefixKey.orElse(queryKey));

  next();
};


module.exports = { versionParser, fieldKeyParser };

