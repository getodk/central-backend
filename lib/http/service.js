// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This file glues together all the middleware and the HTTP REST resources we have
// defined elsewhere into an actual Express service. The only thing it needs in
// order to do this is a valid dependency injection context container.

const Problem = require('../util/problem');


module.exports = (container) => {
  const service = require('express')();

  ////////////////////////////////////////////////////////////////////////////////
  // PRERESOURCE MIDDLEWARE

  // apply the Sentry request hook.
  service.use(container.Sentry.Handlers.requestHandler());

  // automatically parse JSON if it is marked as such. otherwise, just pull the
  // plain-text body contents.
  const bodyParser = require('body-parser');
  service.use(bodyParser.json({ type: 'application/json' }));
  service.use(bodyParser.text({ type: '*/xml', limit: '10mb' }));

  // apache request commonlog.
  const morgan = require('morgan');
  service.use(morgan('common'));

  // version path rewrite must happen as a part of Express middleware.
  const { versionParser, fieldKeyParser } = require('./middleware');
  service.use(versionParser);
  service.use(fieldKeyParser);


  ////////////////////////////////////////////////////////////////////////////////
  // PREPROCESSORS
  // preprocessors are user-space middleware, which work based on promises rather
  // than Express's req/res/next Rack-inspired interface, for functional purity
  // and for easier transaction management.

  const { builder } = require('./endpoint');
  const { emptySessionInjector, sessionHandler, fieldKeyHandler, queryOptionsHandler } = require('./preprocessors');
  const endpoint = builder(container, [ emptySessionInjector, sessionHandler, fieldKeyHandler, queryOptionsHandler ]);


  ////////////////////////////////////////////////////////////////////////////////
  // RESOURCES

  require('../resources/field-keys')(service, endpoint);
  require('../resources/odata')(service, endpoint);
  require('../resources/forms')(service, endpoint);
  require('../resources/users')(service, endpoint);
  require('../resources/sessions')(service, endpoint);
  require('../resources/submissions')(service, endpoint);
  require('../resources/config')(service, endpoint);


  ////////////////////////////////////////////////////////////////////////////////
  // POSTRESOURCE HANDLERS

  // first, translate routing fallthroughs to 404:
  service.use((request, response, next) => { next(Problem.user.notFound()); });

  // apply the Sentry error hook.
  service.use(container.Sentry.Handlers.errorHandler());

  // catch and handle the errors that can happen in express-kernel-space (essentially
  // in the middleware), and internal errors; everything else is handled within
  // user-space in endpoint.
  const Problem = require('../util/problem');
  const { defaultErrorWriter } = require('./endpoint');
  service.use((error, request, response, next) => {
    if (response.headersSent === true) {
      // In this case, we'll just let Express fail the request out.
      next(error);
    } else if ((error != null) && (error.type === 'entity.parse.failed')) {
      // catch body-parser middleware problems. we only ask it to parse JSON, which
      // isn't part of OpenRosa, so we can assume a plain JSON response.
      defaultErrorWriter(Problem.user.unparseable({ format: 'json', rawLength: error.body.length }), request, response);
    } else {
      defaultErrorWriter(error, request, response);
    }
  });

  return service;

};

