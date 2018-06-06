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

const service = require('express')();


module.exports = (container) => {

  ////////////////////////////////////////////////////////////////////////////////
  // PRERESOURCE HANDLERS

  // automatically parse JSON if it is marked as such. otherwise, just pull the
  // plain-text body contents.
  const bodyParser = require('body-parser');
  service.use(bodyParser.json({ type: 'application/json' }));
  service.use(bodyParser.text({ type: '*/xml', limit: '10mb' }));

  // apache request commonlog.
  const morgan = require('morgan');
  service.use(morgan('common'));

  // pull session and version information and pass it on, or reject the request if
  // broken information is provided for either.
  const { versionParser, sessionParser, fieldKeyParser, headerOptionsParser } = require('./middleware');
  service.use(versionParser);
  service.use(sessionParser(container));
  service.use(fieldKeyParser(container));
  service.use(headerOptionsParser);


  ////////////////////////////////////////////////////////////////////////////////
  // RESOURCES

  require('../resources/field-keys')(service, container);
  require('../resources/odata')(service, container);
  require('../resources/forms')(service, container);
  require('../resources/users')(service, container);
  require('../resources/sessions')(service, container);
  require('../resources/submissions')(service, container);
  require('../resources/config')(service, container);


  ////////////////////////////////////////////////////////////////////////////////
  // POSTRESOURCE HANDLERS

  // apply output error handler to everything.
  const { sendError } = require('./endpoint');
  service.use((error, request, response, next) => {
    if (response.headersSent === true) {
      // In this case, we'll just let Express fail the request out.
      return next(error);
    }
    sendError(error, request, response);
  });

  return service;

};

