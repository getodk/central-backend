// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { createReadStream } = require('fs');
const { always } = require('ramda');
const sanitize = require('sanitize-filename');
const { openRosaEndpoint, endpoint } = require('../http/endpoint');
const { createdMessage } = require('../outbound/openrosa');
const { getOrNotFound, getOrReject, rejectIf, resolve, reject } = require('../util/promise');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { streamBriefcaseCsvs } = require('../data/briefcase');
const { streamAttachments } = require('../data/attachments');
const { zipStreamFromParts } = require('../util/zip');

// multipart things:
const multer = require('multer');
const tmpdir = require('tmp').dirSync();
const multipart = multer({ dest: tmpdir.name });

module.exports = (service, { Audit, Blob, Form, Submission, SubmissionAttachment, all }) => {
  // Nonstandard REST; OpenRosa-specific API.
  // This bit of silliness is to address the fact that the OpenRosa standards
  // specification requires the presence of a HEAD /submission endpoint, but
  // does not specify the presence of GET /submission. in order to fulfill that
  // spec without violating the HTTP spec, we have to populate GET /submission
  // with something silly. Unfortunately, because the OpenRosa spec also requires
  // the HEAD request to return with a 204 response code, which indicates that
  // there is no body content, and the HTTP spec requires that HEAD should
  // return exactly what GET would, just without a response body, the only thing
  // we can possibly respond with in either case is no body and a 204 code.
  service.get('/submission', (_, response) => response.status(204).send());

  // Nonstandard REST; OpenRosa-specific API.
  // TODO: it sucks that "transacting" is completely buried here.
  service.post('/submission', multipart.any(), openRosaEndpoint(({ files, auth }) =>
    // first, locate the actual xml and parse it into a partial submission.
    resolve(Option.of(files).map((xs) => xs.find((file) => file.fieldname === 'xml_submission_file')))
      .then(getOrReject(Problem.user.missingMultipartField({ field: 'xml_submission_file' })))
      .then((file) => Submission.fromXml(createReadStream(file.path)))
      // now that we know the target form, fetch it and make sure we can operate on it.
      .then((partial) => Form.transacting().getByXmlFormId(partial.xmlFormId)
        .then(getOrNotFound) // TODO: detail why
        .then((form) => auth.canOrReject('createSubmission', form)
          .then(rejectIf(
            () => !form.acceptsSubmissions(),
            always(Problem.user.notAcceptingSubmissions())
          ))
          .then(() => partial.complete(form, auth.actor()))
          // now we must check for an extant submission by this id, to handle additional
          // posted files.
          // * if an submission exists, we reject unless the xml matches.
          // * if it does not, we create it.
          // either way, we exit this branching promise path with a Promise[Submission]
          // that is complete (eg with an id).
          .then((incoming) => Submission.getById(form.id, incoming.instanceId)
            .then((maybeExtant) => maybeExtant
              .map((extant) => ((Buffer.compare(Buffer.from(extant.xml), Buffer.from(incoming.xml)) !== 0)
                ? reject(Problem.user.xmlConflict())
                : extant))
              .orElse(incoming.create()))
            // now we have a definite submission. we need to go through remaining fields
            // and attempt to add them all as files.
            .then((submission) => all.do(files
              .filter((file) => file.fieldname !== 'xml_submission_file')
              .map((file) => submission.attach(file.fieldname, file.mimetype, file.path)))
              .then(() => Audit.log(auth.actor(), 'createSubmission', form, { submissionId: submission.id })))
            .then(always(createdMessage({ message: 'full submission upload was successful!' }))))))));

  // The remaining endpoints follow a more-standard REST subresource route pattern.
  // This first one performs the operation as the above.
  service.post('/forms/:id/submissions', endpoint(({ params, body, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('createSubmission', form)
        .then(() => Submission.fromXml(body)
          .then(rejectIf(
            (partial) => (partial.xmlFormId !== params.id),
            (partial) => Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' })
          ))
          .then(rejectIf(
            () => !form.acceptsSubmissions(),
            always(Problem.user.notAcceptingSubmissions())
          ))
          .then((partial) => partial.complete(form, auth.actor()).create())
          .then((submission) => Audit.log(auth.actor(), 'createSubmission', form, { submissionId: submission.id })
            .then(always(submission)))))));

  service.get('/forms/:id/submissions.csv.zip', endpoint(({ params, auth }, response) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => all.do([
          Submission.streamRowsByFormId(form.id),
          Submission.streamAttachmentsByFormId(form.id)
        ]).then(([ rows, attachments ]) => {
          const filename = sanitize(form.xmlFormId);
          response.append('Content-Disposition', `attachment; filename="${filename}.zip"`);
          return streamBriefcaseCsvs(rows, form).then((csvStream) =>
            zipStreamFromParts(csvStream, streamAttachments(attachments)));
        })))));

  // TODO: paging.
  service.get('/forms/:id/submissions', endpoint(({ params, auth, queryOptions }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => Submission.getAllByFormId(form.id, queryOptions)))));

  service.get('/forms/:formId/submissions/:instanceId', endpoint(({ params, auth, queryOptions }) =>
    Form.getByXmlFormId(params.formId)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => Submission.getById(form.id, params.instanceId, queryOptions))
        .then(getOrNotFound))));

  service.get('/forms/:formId/submissions/:instanceId/attachments', endpoint(({ params, auth }) =>
    Form.getByXmlFormId(params.formId)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => Submission.getById(form.id, params.instanceId))
        .then(getOrNotFound)
        .then((submission) => submission.getAttachmentMetadata()))));

  service.get('/forms/:formId/submissions/:instanceId/attachments/:name', endpoint(({ params, auth }, response) =>
    Form.getByXmlFormId(params.formId)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        // TODO: can be more performant+compact via a custom join.
        .then(() => Submission.getById(form.id, params.instanceId))
        .then(getOrNotFound)
        .then((submission) => SubmissionAttachment.getBySubmission(submission.id, params.name))
        .then(getOrNotFound)
        .then((attachment) => Blob.getById(attachment.blobId)
          .then(getOrNotFound)
          .then((blob) => {
            response.set('Content-Type', blob.contentType);
            response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
            return blob.content;
          })))));
};


