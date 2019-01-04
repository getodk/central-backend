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
const { getOrNotFound, getOrReject, rejectIf, reject, resolve, ignoringResult } = require('../util/promise');
const { success, xml } = require('../util/http');
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

  ////////////////////////////////////////////////////////////////////////////////
  // SUBMISSIONS (OPENROSA)

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
  service.post('/projects/:projectId/submission', multipart.any(), endpoint.openRosa(({ Audit, Project, Submission }, { params, files, auth }) =>
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
          .then((form) => Submission.getById(form.id, partial.instanceId)
            // we branch based on whether a submission already existed; in either case, we exit this
            // branching promise path with a Promise[Submission] that is complete (eg with an id).
            .then((maybeExtant) => maybeExtant
              // if a submission already exists, first verify that the posted xml still matches
              // (if it does not, reject). then, attach any new posted files.
              .map((extant) => ((Buffer.compare(Buffer.from(extant.xml), Buffer.from(partial.xml)) !== 0)
                ? reject(Problem.user.xmlConflict())
                : resolve(extant).then(ignoringResult((submission) => submission.addAttachments(files)))))
              // otherwise, this is the first POST for this submission. create the
              // submission and the expected attachments:
              .orElseGet(() => partial.complete(form, auth.actor()).create()
                .then(ignoringResult((submission) => submission.createExpectedAttachments(form, files)))))
            // now we have a definite submission; we just need to do audit logging.
            .then((submission) => Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id }))
            // TODO: perhaps actually decide between "full" and "partial"; aggregate does this.
            .then(always(createdMessage({ message: 'full submission upload was successful!' }))))))));


  ////////////////////////////////////////////////////////////////////////////////
  // SUBMISSIONS (STANDARD REST)

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
          .then((submission) => Promise.all([
            submission.createExpectedAttachments(form),
            Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id })
          ])
            .then(always(submission)))))));

  service.get('/projects/:projectId/forms/:id/submissions.csv.zip', endpoint(({ all, Project, Submission, SubmissionAttachment }, { params, auth }, _, response) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.read', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => all.do([
          Submission.streamByFormId(form.id),
          SubmissionAttachment.streamByFormId(form.id)
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


  ////////////////////////////////////////////////////////////////////////////////
  // SUBMISSION ATTACHMENTS

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
          .then((submission) => SubmissionAttachment.getBySubmissionId(submission.id, params.name))
          .then(getOrNotFound)
          .then((attachment) => Blob.getById(attachment.blobId)
            .then(getOrNotFound)
            .then((blob) => {
              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
              return blob.content;
            }))))
  );

  service.post(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments/:name',
    endpoint(({ Blob, Project, Submission }, { params, headers, auth }, request) =>
      Promise.all([
        Project.getById(params.projectId)
          .then(getOrNotFound)
          .then((project) => auth.canOrReject('submission.update', project)
            .then(() => project.getFormByXmlFormId(params.formId))
            .then(getOrNotFound)
            .then((form) => Submission.getById(form.id, params.instanceId))
            .then(getOrNotFound)),
        Blob.fromStream(request, headers['content-type'])
          .then((blob) => blob.create())
      ])
        // TODO: audit-log creation? (but we don't do it when via openrosa..)
        .then(([ submission, blob ]) => submission.attach(params.name, blob))
        .then((wasSuccessful) => (wasSuccessful
          ? success()
          // should only be a Resolve[False] if everything worked but there wasn't a row to update.
          : reject(Problem.user.notFound()))))
  );

  service.delete(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments/:name',
    endpoint(({ Audit, Project, Submission, SubmissionAttachment }, { params, auth }) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('submission.update', project)
          .then(() => project.getFormByXmlFormId(params.formId))
          .then(getOrNotFound)
          // TODO: as with above (copy+paste) can be more performant+compact via a custom join.
          .then((form) => Submission.getById(form.id, params.instanceId)
            .then(getOrNotFound)
            .then((submission) => SubmissionAttachment.getBySubmissionId(submission.id, params.name))
            .then(getOrNotFound)
            .then((attachment) => Promise.all([
              attachment.clear(),
              Audit.log(auth.actor(), 'submission.attachment.clear', form, { name: attachment.name, blobId: attachment.blobId })
            ]))
            .then(success))))
  );
};

