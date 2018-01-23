const { readFileSync } = require('fs');
const { always } = require('ramda');
const { openRosaEndpoint, endpoint, getOrNotFound } = require('../util/http');
const { openRosaMessage } = require('../outbound/openrosa');
const { streamDataZip } = require('../data/csv');

// multipart things:
const multer = require('multer');
const tmpdir = require('tmp').dirSync();
const multipart = multer({ dest: tmpdir.name });

module.exports = (service, { Audit, Submission, Form }) => {
  // Nonstandard REST; OpenRosa-specific API.
  // This bit of silliness is to address the fact that the OpenRosa standards
  // specification requires the presence of a HEAD /submission endpoint, but
  // does not specify the presence of GET /submission. in order to fulfill that
  // spec without violating the HTTP spec, we have to populate GET /submission
  // with something silly.
  service.get('/submission', endpoint(() =>
    ({ message: 'You should use POST to submit to /submission.' })));

  // Nonstandard REST; OpenRosa-specific API.
  // We actually are a little bit nonstandard compared to OpenRosa; in addition
  // to the OpenRosa-specified multipart POST, we also allow simple POST of the
  // XML as the POST body (provided a Content-Type of application/xml or text/xml
  // rather than multipart/form-data), as these requests are far easier to construct.
  // TODO: multiple POSTS should apparently amend the multimedia slate? or overwrite?
  service.post('/submission', multipart.single('xml_submission_file'), openRosaEndpoint(({ file, body, auth }) =>
    // TODO: for post-initial-release, it seems we need to (sigh) swap xml parsers
    // yet again, as this one doesn't seem to work on streams. readFileSync is a bad
    // tool to use here. ideally we could use createReadStream instead.
    Submission.fromXml((file != null) ? readFileSync(file.path) : body)
      .then((partial) => Form.getByXmlFormId(partial.xmlFormId)
        .then(getOrNotFound) // TODO: detail why
        .then((form) => auth.canOrReject('createSubmission', form)
          .then(() => partial.complete(form, auth.actor()).create())
          .then((submission) => Audit.log(auth.actor(), 'createSubmission', form, { submissionId: submission.id }))
          .then(always(openRosaMessage(201, { message: 'full submission upload was successful!' })))))));

  // The remaining endpoints follow a more-standard REST subresource route pattern.
  // This first one performs the operation as the above.
  service.post('/forms/:id/submissions', endpoint(({ params, body, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('createSubmission', form)
        .then(() => Submission.fromXml(body)
          .then((partial) => partial.complete(form, auth.actor()).create())
          .then((submission) => Audit.log(auth.actor(), 'createSubmission', form, { submissionId: submission.id })
            .then(always(submission)))))));

  service.get('/forms/:id/submissions.csv.zip', endpoint(({ params, auth }, response) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => Submission.streamAllByFormId(form.id)
          .then((stream) => {
            // TODO: sanitize form id?
            response.append('Content-Disposition', `attachment; filename=${form.xmlFormId}.zip`);
            return streamDataZip(stream, form);
          })))));

  // TODO: paging.
  service.get('/forms/:id/submissions', endpoint(({ params, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => Submission.getAllByFormId(form.id)))));

  service.get('/forms/:formId/submissions/:instanceId', endpoint(({ params, auth }) =>
    Form.getByXmlFormId(params.formId)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => Submission.getById(form.id, params.instanceId)))));
};


