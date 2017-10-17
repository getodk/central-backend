const bodyParser = require('body-parser');
const morgan = require('morgan');
const service = require('express')();

const BaseModel = require('./model/base-model');
const JubilantRouter = require('./jubilant-router');
const { connect } = require('./model/database');



////////////////////////////////////////////////////////////////////////////////
// DATABASE SETUP

// initialize our top-level static database instance.
BaseModel.db(connect());



////////////////////////////////////////////////////////////////////////////////
// SERVICE SETUP

// for now, just take in plain-text bodies. easy to augment with other formats.
service.use(bodyParser.text({ type: '*/*' }));

// apache request commonlog.
service.use(morgan('common'));

// Routing for requests
new JubilantRouter(service).routeAll();



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
