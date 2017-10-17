const bodyParser = require('body-parser');
const morgan = require('morgan');
const service = require('express')();

const BaseModel = require('./model/base-model');
const FormsController = require('./controller/forms-controller');
const SubmissionsController = require('./controller/submissions-controller');
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



////////////////////////////////////////////////////////////////////////////////
// SUBMISSIONS (nonstandard ODK API)

service.post('/submissions', (request, response) =>
  new SubmissionsController(request, response).create());



////////////////////////////////////////////////////////////////////////////////
// FORMS (via REST)

service.post('/forms', (request, response) =>
  new FormsController(request, response).create());
service.get('/forms', (request, response) =>
  new FormsController(request, response).list());
service.get('/forms/:xmlFormId', (request, response) =>
  new FormsController(request, response).get());



////////////////////////////////////////////////////////////////////////////////
// SUBMISSIONS (via REST, subresource of forms)

service.get('/forms/:xmlFormId/submissions', (request, response) =>
  new SubmissionsController(request, response).list());
service.get('/forms/:xmlFormId/submissions/:instanceId', (request, response) =>
  new SubmissionsController(request, response).get());



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
