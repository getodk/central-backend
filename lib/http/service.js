// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This file glues together all the middleware and the HTTP REST resources we have
// defined elsewhere into an actual Express service. The only thing it needs in
// order to do this is a valid dependency injection context container.
const { match } = require('path-to-regexp');

module.exports = (container) => {
  const service = require('express')();
  service.disable('x-powered-by');

  ////////////////////////////////////////////////////////////////////////////////
  // PRERESOURCE MIDDLEWARE

  // apply the Sentry request hook.
  service.use(container.Sentry.Handlers.requestHandler());

  service.use((req, res, next) => {
    container.Sentry.configureScope(scope => {
      scope.setExtra('startTimestamp', Date.now());
    });
    next();
  });

  // automatically parse JSON if it is marked as such. otherwise, just pull the
  // plain-text body contents.
  const bodyParser = require('body-parser');

  // use a default json limit except for URLs that explicitly need a larger limit.
  const defaultJsonLimit = bodyParser.json({ type: 'application/json', limit: '250kb' });
  const largeJsonLimit = bodyParser.json({ type: 'application/json', limit: '100mb' });
  const largeJsonUrlMatch = match('/:apiVersion/projects/:id/datasets/:name/entities');
  // only apply body-parser middleware to request types which should have a body.
  service.patch('/*', defaultJsonLimit);
  service.put('/*', defaultJsonLimit);
  service.post('/*', (req, res, next) => {
    if (largeJsonUrlMatch(req.path))
      return largeJsonLimit(req, res, next);
    return defaultJsonLimit(req, res, next);
  });

  // apache request commonlog.
  const morgan = require('morgan');
  service.use(morgan('common'));

  // version path rewrite must happen as a part of Express middleware.
  const { versionParser, fieldKeyParser } = require('./middleware');
  service.use(versionParser);
  service.use(fieldKeyParser);

  const cookieParser = require('cookie-parser');
  service.use(cookieParser());

  service.use((req, res, next) => {
    // TODO only set for safe methods?
    // TODO only set for authenticated requests?
    if (req.path.startsWith('/sessions/')) {
      res.set('Cache-Control', 'no-store');
    } else {
      res.set('Cache-Control', 'private, max-age=20');
    }
    next();
  });


  ////////////////////////////////////////////////////////////////////////////////
  // PREPROCESSORS
  // preprocessors are user-space middleware, which work based on promises rather
  // than Express's req/res/next Rack-inspired interface, for functional purity
  // and for easier transaction management.

  const { builder } = require('./endpoint');
  const { emptyAuthInjector, authHandler, queryOptionsHandler, userAgentHandler } = require('./preprocessors');
  const endpoint = builder(container, [ emptyAuthInjector, authHandler, queryOptionsHandler, userAgentHandler ]);


  ////////////////////////////////////////////////////////////////////////////////
  // RESOURCES

  require('../resources/app-users')(service, endpoint);
  require('../resources/odata')(service, endpoint);
  require('../resources/odata-entities')(service, endpoint);
  require('../resources/forms')(service, endpoint);
  require('../resources/users')(service, endpoint);
  require('../resources/sessions')(service, endpoint);
  require('../resources/submissions')(service, endpoint);
  require('../resources/config')(service, endpoint);
  require('../resources/projects')(service, endpoint);
  require('../resources/roles')(service, endpoint);
  require('../resources/assignments')(service, endpoint);
  require('../resources/audits')(service, endpoint);
  require('../resources/public-links')(service, endpoint);
  require('../resources/backup')(service, endpoint);
  require('../resources/comments')(service, endpoint);
  require('../resources/analytics')(service, endpoint);
  require('../resources/datasets')(service, endpoint);
  require('../resources/entities')(service, endpoint);
  require('../resources/oidc')(service, endpoint);
  require('../resources/user-preferences')(service, endpoint);

  ////////////////////////////////////////////////////////////////////////////////
  // POSTRESOURCE HANDLERS

  const Problem = require('../util/problem');

  // first, translate routing fallthroughs to 404:
  service.use((request, response, next) => { next(Problem.user.notFound()); });

  // strip inappropriate headers from error responses
  service.use((error, request, response, next) => {
    if (response.headersSent) {
      // too late to do anything
    } else {
      response.removeHeader('ETag');
    }
    next(error);
  });

  // apply the Sentry error hook.
  service.use(container.Sentry.Handlers.errorHandler());

  // catch and handle the errors that can happen in express-kernel-space (essentially
  // in the middleware), and internal errors; everything else is handled within
  // user-space in endpoint.
  const { defaultErrorWriter } = require('./endpoint');
  service.use((error, request, response, next) => {
    if (response.headersSent === true) {
      // In this case, we'll just let Express fail the request out.
      return next(error);
    }

    // catch body-parser middleware problems. we only ask it to parse JSON, which
    // isn't part of OpenRosa, so we can assume a plain JSON response.
    switch (error?.type) {
      case 'encoding.unsupported': return defaultErrorWriter(Problem.user.encodingNotSupported(), request, response);
      case 'entity.parse.failed': return defaultErrorWriter(Problem.user.unparseable({ format: 'json', rawLength: error.body.length }), request, response);
      case 'entity.too.large': return defaultErrorWriter(Problem.user.requestTooLarge(), request, response);
      default: return defaultErrorWriter(error, request, response);
    }

  });

  return service;

};

