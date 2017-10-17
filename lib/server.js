const service = require('express')();
const bodyParser = require('body-parser');
const morgan = require('morgan');

const BaseModel = require('./model/base-model');
const Form = require('./model/form');
const Submission = require('./model/submission');
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

// combined endpoint for POSTing any form submission.
service.post('/submissions', (request, response) => {
  Submission
    .fromXml(request.body)
    .then(submission => submission.save())
    .then(ok(response), sendError(response));
});



////////////////////////////////////////////////////////////////////////////////
// FORMS (via REST)

// saves a new form definition.
service.post('/forms', (request, response) => {
  Form
    .fromXml(request.body)
    .then(form => form.save())
    .then(ok(response), sendError(response));
});

// Gets all form definitions.
service.get('/forms', (request, response) =>
  Form.all().loadRows().then(ok(response), sendError(response)));

// returns a form definition.
service.get('/forms/:xmlFormId', (request, response) => {
  Form
    .forXmlFormId(request.params.xmlFormId)
    .loadRowElseError('Cannot find form with the given ID.')
    .then(ok(response), sendError(response));
});



////////////////////////////////////////////////////////////////////////////////
// SUBMISSIONS (via REST, subresource of forms)

// get all submissions for any form.
service.get('/forms/:xmlFormId/submissions', (request, response) => {
  Form
    .forXmlFormId(request.params.xmlFormId)
    .loadRowElseError('Cannot find form with the given ID.')
    .then(form => Submission.forFormId(form.id).forApi().loadRows())
    .then(ok(response), sendError(response));
});

// get a single submission for a single form.
service.get('/forms/:xmlFormId/submissions/:instanceId', (request, response) => {
  Form
    .forXmlFormId(request.params.xmlFormId)
    .loadRowElseError('Cannot find form with the given ID.')
    .then(form => Submission
      .forFormId(form.id)
      .forInstanceId(request.params.instanceId)
      .loadRowElseError('Cannot find submission with the given form ID and instance ID.'))
    .then(ok(response), sendError(response));
});

/*
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

