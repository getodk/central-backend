const service = require('express')();
const bodyParser = require('body-parser');
const morgan = require('morgan');

const BaseModel = require('./model/base-model');
const Form = require('./model/form');
const { ok, sendError } = require('./util');
const { connect } = require('./model/database');
//const { submissionsToZipStream } = require('./xml');



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

/*
// combined endpoint for POSTing any form submission.
service.post('/submissions', (request, response) => {
  const submission = Submission.fromXml(request.body);
  if (submission instanceof Error)
    badRequest(response, submission);
  else
    submission.save().then(ok(response)).catch(dbErrorHandler(response));
});
*/



////////////////////////////////////////////////////////////////////////////////
// FORMS (via REST)

// saves a new form definition.
service.post('/forms', (request, response) => {
  const [ form, error ] = Form.fromXml(request.body);
  if (error != null)
    sendError(response, error);
  else
    form.save().then(ok(response), sendError(response));
});

// returns a form definition.
service.get('/forms/:xmlFormId', (request, response) => {
  Form
    .forXmlFormId(request.params.xmlFormId)
    .loadRowElseError('Cannot find form with the given ID.')
    .then(ok(response), sendError(response));
});



/*
////////////////////////////////////////////////////////////////////////////////
// SUBMISSIONS (via REST, subresource of forms)

// get all submissions for any form.
service.get('/forms/:formId/submissions', (request, response) => {
  Submission.listByFormId(request.params.formId)
    .then(ok(response)).catch(dbErrorHandler(response));
});

// get a single submission for a single form.
service.get('/forms/:formId/submissions/:instanceId', (request, response) => {
  Submission.getSingle(request.params.formId, request.params.instanceId)
    .then(ok(response)).catch(dbErrorHandler(response));
});

// get all submissions for any form in ZIP format containing joinable CSVs.
service.get('/forms/:formId/submissions.csv.zip', async (request, response) => {
  const formId = request.params.formId;
  const template = await Form.getByXmlFormId(formId);
  if (template == null) return notFound(response);

  Submission.queryByFormId(formId).stream((stream) => {
    response.append('Content-Disposition', `attachment; filename="${formId}.csv.zip"`);
    submissionsToZipStream(formId, stream, template).pipe(response);
  });
});
*/


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

