const { readFileSync } = require('fs');
const { always } = require('ramda');
const { openRosaEndpoint, endpoint, getOrNotFound, getOrReject } = require('../util/http');
const { openRosaMessage } = require('../outbound/openrosa');
const { resolve } = require('../reused/promise');
const Option = require('../reused/option');
const Problem = require('../problem');
const { streamDataZip } = require('../data/csv');

// multipart things:
const multer = require('multer');
const tmpdir = require('tmp').dirSync();
const multipart = multer({ dest: tmpdir.name });

module.exports = (service, { Audit, Submission, Form, all }) => {
  // Nonstandard REST; OpenRosa-specific API.
  // This bit of silliness is to address the fact that the OpenRosa standards
  // specification requires the presence of a HEAD /submission endpoint, but
  // does not specify the presence of GET /submission. in order to fulfill that
  // spec without violating the HTTP spec, we have to populate GET /submission
  // with something silly.
  service.head('/submission', (_, response) => response.status(204).send());
  service.get('/submission', (_, response) =>
    response.status(200).send({ message: 'You should use POST to submit to /submission.' }));

  // Nonstandard REST; OpenRosa-specific API.
  // TODO: for post-initial-release, it seems we need to (sigh) swap xml parsers
  // yet again, as this one doesn't seem to work on streams. readFileSync is a bad
  // tool to use here. ideally we could use createReadStream instead.
  // TODO: this library leaves something to be desired; it will not even work with
  // Buffers, only Strings.
  // TODO: it sucks that "transacting" is completely buried here.
  service.post('/submission', multipart.any(), openRosaEndpoint(({ files, body, auth }) =>
    // first, locate the actual xml and parse it into a partial submission.
    resolve(Option.of(files.find((file) => file.fieldname === 'xml_submission_file')))
      .then(getOrReject(Problem.user.missingParameter({ field: 'xml_submission_file' })))
      .then((file) => Submission.fromXml(readFileSync(file.path).toString()))
      // now that we know the target form, fetch it and make sure we can operate on it.
      .then((partial) => Form.transacting().getByXmlFormId(partial.xmlFormId)
        .then(getOrNotFound) // TODO: detail why
        .then((form) => auth.canOrReject('createSubmission', form)
          .then(() => partial.complete(form, auth.actor()))
          // now we must check for an extant submission by this id, to handle additional
          // posted files.
          // * if an submission exists, we reject unless the xml matches.
          // * if it does not, we create it.
          // either way, we exit this branching promise path with a Promise[Submission]
          // that is complete (eg with an id).
          .then((incoming) => Submission.getById(form.id, incoming.instanceId)
            .then((maybeExtant) => maybeExtant
              .map((extant) => (extant.xml !== incoming.xml)
                ? reject(Problem.user.xmlConflict())
                : extant)
              .orElse(incoming.create()))
            // now we have a definite submission. we need to go through remaining fields
            // and attempt to add them all as files.
            .then((submission) => all.do(files
                .filter((file) => file.fieldname !== 'xml_submission_file')
                .map((file) => submission.attach(file.fieldname, file.mimetype, file.path)))
              .then(() => Audit.log(auth.actor(), 'createSubmission', form, { submissionId: submission.id })))
            .then(always(openRosaMessage(201, { message: 'full submission upload was successful!' }))))))));

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


