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
const { createdMessage } = require('../outbound/openrosa');
const { getOrNotFound, getOrReject, rejectIf, reject } = require('../util/promise');
const { xml } = require('../util/http');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { streamBriefcaseCsvs } = require('../data/briefcase');
const { streamAttachments } = require('../data/attachments');
const { zipStreamFromParts } = require('../util/zip');

// multipart things:
const multer = require('multer');
const tmpdir = require('tmp').dirSync();
const multipart = multer({ dest: tmpdir.name });

module.exports = (service, endpoint) => {
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
  service.get('/projects/:projectId/submission', endpoint(({ Project }, { params }, request, response) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then(() => {
        response.status(204);
        return false; // TODO: we need to return something non-null but this is a lousy choice.
      })));

  // Nonstandard REST; OpenRosa-specific API.
  service.post('/projects/:projectId/submission', multipart.any(), endpoint.openRosa(({ all, Audit, Project, Submission }, { params, files, auth }) =>
    // first, make sure the project exists, and that we have the right to submit to it.
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.create', project)
        // then locate the actual xml and parse it into a partial submission.
        .then(() => Option.of(files).map((xs) => xs.find((file) => file.fieldname === 'xml_submission_file')))
        .then(getOrReject(Problem.user.missingMultipartField({ field: 'xml_submission_file' })))
        .then((file) => Submission.fromXml(createReadStream(file.path)))
        // now that we know the target form, fetch it and make sure it's accepting submissions.
        .then((partial) => project.getFormByXmlFormId(partial.xmlFormId)
          .then(getOrNotFound) // TODO: detail why
          .then(rejectIf(
            (form) => !form.acceptsSubmissions(),
            always(Problem.user.notAcceptingSubmissions())
          ))
          // now we must check for an extant submission by this id, to handle additional
          // posted files.
          // * if an submission exists, we reject unless the xml matches.
          // * if it does not, we create it.
          // either way, we exit this branching promise path with a Promise[Submission]
          // that is complete (eg with an id).
          .then((form) => Submission.getById(form.id, partial.instanceId)
            .then((maybeExtant) => maybeExtant
              .map((extant) => ((Buffer.compare(Buffer.from(extant.xml), Buffer.from(partial.xml)) !== 0)
                ? reject(Problem.user.xmlConflict())
                : extant))
              .orElseGet(() => partial.complete(form, auth.actor()).create()))
            // now we have a definite submission. we need to go through remaining fields
            // and attempt to add them all as files.
            .then((submission) => all.do(files
              .filter((file) => file.fieldname !== 'xml_submission_file')
              .map((file) => submission.attach(file.fieldname, file.mimetype, file.path)))
              .then(() => Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id })))
            .then(always(createdMessage({ message: 'full submission upload was successful!' }))))))));

  // The remaining endpoints follow a more-standard REST subresource route pattern.
  // This first one performs the operation as the above.
  service.post('/projects/:projectId/forms/:id/submissions', endpoint(({ Audit, Project, Submission }, { params, body, auth }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.create', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => Submission.fromXml(body)
          .then(rejectIf(
            (partial) => (partial.xmlFormId !== params.id),
            (partial) => Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' })
          ))
          .then(rejectIf(
            () => !form.acceptsSubmissions(),
            always(Problem.user.notAcceptingSubmissions())
          ))
          .then((partial) => partial.complete(form, auth.actor()).create())
          .then((submission) => Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id })
            .then(always(submission)))))));

  service.get('/projects/:projectId/forms/:id/submissions.csv.zip', endpoint(({ all, Project, Submission }, { params, auth }, _, response) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.read', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => all.do([
          Submission.streamRowsByFormId(form.id),
          Submission.streamAttachmentsByFormId(form.id)
        ]).then(([ rows, attachments ]) => {
          const filename = sanitize(form.xmlFormId);
          response.append('Content-Disposition', `attachment; filename="${filename}.zip"`);
          return streamBriefcaseCsvs(rows, form).then((csvStream) =>
            zipStreamFromParts(csvStream, streamAttachments(attachments)));
        })))));

  // TODO: paging.
  service.get('/projects/:projectId/forms/:id/submissions', endpoint(({ Project, Submission }, { params, auth, queryOptions }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.list', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => Submission.getAllByFormId(form.id, queryOptions)))));

  service.get('/projects/:projectId/forms/:formId/submissions/:instanceId.xml', endpoint(({ Project, Submission }, { params, auth, queryOptions }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.read', project)
        .then(() => project.getFormByXmlFormId(params.formId))
        .then(getOrNotFound)
        .then((form) => Submission.getById(form.id, params.instanceId, queryOptions))
        .then(getOrNotFound)
        .then((submission) => xml(submission.xml)))));

  service.get('/projects/:projectId/forms/:formId/submissions/:instanceId', endpoint(({ Project, Submission }, { params, auth, queryOptions }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.read', project)
        .then(() => project.getFormByXmlFormId(params.formId))
        .then(getOrNotFound)
        .then((form) => Submission.getById(form.id, params.instanceId, queryOptions))
        .then(getOrNotFound))));

  service.get(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments',
    endpoint(({ Project, Submission }, { params, auth }) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('submission.read', project)
          .then(() => project.getFormByXmlFormId(params.formId))
          .then(getOrNotFound)
          .then((form) => Submission.getById(form.id, params.instanceId))
          .then(getOrNotFound)
          .then((submission) => submission.getAttachmentMetadata())))
  );

  service.get(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments/:name',
    endpoint(({ Blob, Project, Submission, SubmissionAttachment }, { params, auth }, _, response) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('submission.read', project)
          .then(() => project.getFormByXmlFormId(params.formId))
          .then(getOrNotFound)
          // TODO: can be more performant+compact via a custom join.
          .then((form) => Submission.getById(form.id, params.instanceId))
          .then(getOrNotFound)
          .then((submission) => SubmissionAttachment.getBySubmission(submission.id, params.name))
          .then(getOrNotFound)
          .then((attachment) => Blob.getById(attachment.blobId)
            .then(getOrNotFound)
            .then((blob) => {
              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
              return blob.content;
            }))))
  );
};


