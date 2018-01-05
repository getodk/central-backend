const service = require('express')();


module.exports = (container) => {

  ////////////////////////////////////////////////////////////////////////////////
  // PRERESOURCE HANDLERS

  // automatically parse JSON if it is marked as such. otherwise, just pull the
  // plain-text body contents.
  const bodyParser = require('body-parser');
  service.use(bodyParser.json({ type: 'application/json' }));
  service.use(bodyParser.text({ type: '*/xml' }));

  // apache request commonlog.
  const morgan = require('morgan');
  service.use(morgan('common'));

  // pull session and version information and pass it on, or reject the request if
  // broken information is provided for either.
  const { versionParser, sessionParser } = require('./util/http');
  service.use(versionParser);
  service.use(sessionParser(container));


  ////////////////////////////////////////////////////////////////////////////////
  // RESOURCES

  require('./resources/forms')(service, container);
  require('./resources/users')(service, container);
  require('./resources/sessions')(service, container);
  require('./resources/submissions')(service, container);


  ////////////////////////////////////////////////////////////////////////////////
  // POSTRESOURCE HANDLERS

  // apply output error handler to everything.
  const { sendError } = require('./util/http');
  service.use((error, request, response, next) => {
    if (response.headersSent === true) {
      // In this case, we'll just let Express fail the request out.
      return next(error);
    }
    sendError(error, request, response);
  });

  return service;

};

