const BaseController = require('./base-controller');
const Form = require('../model/form');
const Submission = require('../model/submission');
//const { submissionsToZipStream } = require('./xml');


class SubmissionsController extends BaseController {
  // Saves a new submission.
  create() {
    Submission
      .fromXml(this.request.body)
      .then(submission => submission.save())
      .then(this.ok, this.error);
  }

  // Gets all submissions for a specified form.
  list() {
    this
      ._loadForm()
      .then(form => Submission.forFormId(form.id).forApi().loadRows())
      .then(this.ok, this.error);
  }

  // Gets a single submission for a specified form.
  get() {
    this
      ._loadForm()
      .then(form => Submission
        .forFormId(form.id)
        .forInstanceId(this.request.params.instanceId)
        .loadRowElseError('Cannot find submission with the given form ID and instance ID.'))
      .then(this.ok, this.error);
  }

  _loadForm() {
    return Form
      .forXmlFormId(this.request.params.xmlFormId)
      .loadRowElseError('Cannot find form with the given ID.');
  }
}

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

module.exports = SubmissionsController;
