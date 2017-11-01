const service = require('express')();
const bodyParser = require('body-parser');
const morgan = require('morgan');


////////////////////////////////////////////////////////////////////////////////
// DATABASE SETUP

// initialize our top-level static database instance.
const { connect } = require('./model/database');
const db = connect();

// initialize our model objects.
/* eslint-disable */ // or else it will complain about global-require here
const container = require('./model/package')(db, {
  queries: {
    actees: require('./model/query/actees'),
    actors: require('./model/query/actors'),
    simply: require('./model/query/simply'),
    users: require('./model/query/users')
  },
  instances: {
    Actee: require('./model/instance/actee'),
    Actor: require('./model/instance/actor'),
    User: require('./model/instance/user')
  }
});
/* eslint-enable */


////////////////////////////////////////////////////////////////////////////////
// PRERESOURCE HANDLERS

// automatically parse JSON if it is marked as such. otherwise, just pull the
// plain-text body contents.
service.use(bodyParser.json({ type: 'application/json' }));
service.use(bodyParser.text({ type: '*/*' }));

// apache request commonlog.
service.use(morgan('common'));


////////////////////////////////////////////////////////////////////////////////
// RESOURCES

require('./resources/users')(service, container);
//require('./resources/sessions')(service, container);
//require('./resources/forms')(service, container);


////////////////////////////////////////////////////////////////////////////////
// POSTRESOURCE HANDLERS

// apply output error handler to everything.
const { sendError } = require('./util/http');
service.use((error, request, response, next) => {
  if (response.headersSent === true) {
    // In this case, we'll just let Express fail the request out.
    return next(error);
  }
  sendError(response, error);
});


////////////////////////////////////////////////////////////////////////////////
// PROCESS SETUP

// start the service.
service.listen(8383, () => {
  // notify parent process we are alive if applicable.
  if (process.send != null) process.send('online');
});
process.on('message', (message) => { // parent process.
  if (message === 'shutdown') process.exit(0);
  // TODO: do we need to cleanup database?
});

