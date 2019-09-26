// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { createReadStream } = require('fs');
const { always, map } = require('ramda');
const sanitize = require('sanitize-filename');
const { createdMessage } = require('../outbound/openrosa');
const { getOrNotFound, getOrReject, rejectIf, reject, ignoringResult } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { success, xml } = require('../util/http');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { streamBriefcaseCsvs } = require('../data/briefcase');
const { streamAttachments } = require('../data/attachments');
const { streamClientAudits } = require('../data/client-audits');
const { streamFromBuffer } = require('../util/stream');
const { zipStreamFromParts } = require('../util/zip');

// multipart things:
const multer = require('multer');
const tmpdir = require('tmp').dirSync();
const multipart = multer({ dest: tmpdir.name });

// formbody things:
const bodyParser = require('body-parser');
const formParser = bodyParser.urlencoded({ extended: false });

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
      .then(() => { response.status(204); })));

  // Nonstandard REST; OpenRosa-specific API.
  service.post('/projects/:projectId/submission', multipart.any(), endpoint.openRosa(({ Audit, Project, Submission, SubmissionPartial }, { params, files, auth, query }) =>
    // first, make sure the project exists, and that we have the right to submit to it.
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.create', project)
        // then locate the actual xml and parse it into a partial submission.
        .then(() => Option.of(files).map((xs) => xs.find((file) => file.fieldname === 'xml_submission_file')))
        .then(getOrReject(Problem.user.missingMultipartField({ field: 'xml_submission_file' })))
        .then((file) => SubmissionPartial.fromXml(createReadStream(file.path)))
        // now that we know the target form, fetch it and make sure it's accepting submissions.
        .then((partial) => project.getFormByXmlFormId(partial.xmlFormId)
          .then(getOrNotFound) // TODO: detail why
          .then(rejectIf(
            (form) => !form.acceptsSubmissions(),
            Problem.user.notAcceptingSubmissions
          ))
          .then((form) => Submission.getById(form.id, partial.instanceId, QueryOptions.extended)
            // we branch based on whether a submission already existed; in either case, we exit this
            // branching promise path with a Promise[Submission] that is complete (eg with an id).
            .then((maybeExtant) => maybeExtant
              // if a submission already exists, first verify that the posted xml still matches
              // (if it does not, reject). then, attach any new posted files.
              .map((extant) => extant.getCurrentVersion()
                .then(getOrNotFound) // TODO: sort of a goofy bailout case.
                .then((extantVersion) => ((Buffer.compare(Buffer.from(extantVersion.xml), Buffer.from(partial.xml)) !== 0)
                  ? reject(Problem.user.xmlConflict())
                  : extantVersion.upsertAttachments(files))))
              // otherwise, this is the first POST for this submission. create the
              // submission and the expected attachments:
              .orElseGet(() => partial.createAll(form, auth.actor(), query.deviceID)
                .then(ignoringResult(({ submissionDef }) =>
                  submissionDef.createExpectedAttachments(form.def, files)))))
            // now we have a definite submission; we just need to do audit logging.
            .then((submission) => Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id, instanceId: submission.instanceId }))
            // TODO: perhaps actually decide between "full" and "partial"; aggregate does this.
            .then(always(createdMessage({ message: 'full submission upload was successful!' }))))))));


  ////////////////////////////////////////////////////////////////////////////////
  // SUBMISSIONS (STANDARD REST)

  // The remaining endpoints follow a more-standard REST subresource route pattern.
  // This first one performs the operation as the above.
  service.post('/projects/:projectId/forms/:id/submissions', endpoint(({ Audit, Project, SubmissionPartial }, { params, body, auth }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.create', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => SubmissionPartial.fromXml(body)
          .then(rejectIf(
            (partial) => (partial.xmlFormId !== params.id),
            (partial) => Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' })
          ))
          .then(rejectIf(
            () => !form.acceptsSubmissions(),
            always(Problem.user.notAcceptingSubmissions())
          ))
          .then((partial) => partial.createAll(form, auth.actor()))
          .then(({ submission, submissionDef }) => Promise.all([
            submissionDef.createExpectedAttachments(form.def),
            Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id, instanceId: submission.instanceId })
          ])
            .then(always(submission)))))));

  ////////////////////////////////////////
  // CSVZIP EXPORT

  const csvzip = ({ ClientAudit, Key, Project, SubmissionAttachment, SubmissionDef },
    auth, projectId, xmlFormId, passphraseData, response) =>
    Project.getById(projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.read', project)
        .then(() => project.getFormByXmlFormId(xmlFormId))
        .then(getOrNotFound)
        .then((form) => Promise.all([
          SubmissionDef.streamForExport(form.id, Object.keys(passphraseData)),
          SubmissionAttachment.streamForExport(form.id, Object.keys(passphraseData)), // TODO: repetitive
          ClientAudit.streamForExport(form.id),
          Key.getDecryptor(map(decodeURIComponent, passphraseData)) // will do nothing if {}
        ]).then(([ rows, attachments, clientAudits, decryptor ]) => {
          const filename = sanitize(form.xmlFormId);
          response.append('Content-Disposition', `attachment; filename="${filename}.zip"`);
          response.append('Content-Type', 'application/zip');
          return streamBriefcaseCsvs(rows, form, decryptor).then((csvStream) =>
            zipStreamFromParts(csvStream,
              streamAttachments(attachments, decryptor),
              streamClientAudits(clientAudits, form)));
        })));

  service.get('/projects/:projectId/forms/:id/submissions.csv.zip', endpoint((container, { params, auth, query }, _, response) =>
    csvzip(container, auth, params.projectId, params.id, query, response)));

  service.post('/projects/:projectId/forms/:id/submissions.csv.zip', formParser, endpoint((container, { params, auth, body }, _, response) =>
    csvzip(container, auth, params.projectId, params.id, body, response)));

  // CSVZIP EXPORT
  ////////////////////////////////////////

  // TODO: paging.
  service.get('/projects/:projectId/forms/:id/submissions', endpoint(({ Project, Submission }, { params, auth, queryOptions }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.list', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => Submission.getAllByFormId(form.id, queryOptions)))));

  service.get('/projects/:projectId/forms/:formId/submissions/keys',
    endpoint(({ Key, Project }, { params, auth }) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('submission.read', project)
          .then(() => project.getFormByXmlFormId(params.formId)))
        .then(getOrNotFound)
        .then((form) => Key.getActiveByFormId(form.id))));

  service.get('/projects/:projectId/forms/:formId/submissions/:instanceId.xml', endpoint(({ Project, SubmissionDef }, { params, auth }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('submission.read', project)
        .then(() => SubmissionDef.getCurrentByIds(project.id, params.formId, params.instanceId))
        .then(getOrNotFound)
        .then((def) => xml(def.xml)))));

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
  // TODO: a lot of layers to select through one at a time. eventually make more efficient.

  service.get(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments',
    endpoint(({ Project, SubmissionDef }, { params, auth }) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('submission.read', project)
          .then(() => SubmissionDef.getCurrentByIds(project.id, params.formId, params.instanceId))
          .then(getOrNotFound)
          .then((def) => def.getAttachmentMetadata())))
  );

  service.get(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments/:name',
    endpoint(({ Blob, Project, SubmissionAttachment, SubmissionDef }, { params, auth }, _, response) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('submission.read', project)
          .then(() => SubmissionDef.getCurrentByIds(project.id, params.formId, params.instanceId))
          .then(getOrNotFound)
          .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, params.name))
          .then(getOrNotFound)
          .then((attachment) => Blob.getById(attachment.blobId)
            .then(getOrNotFound)
            .then((blob) => {
              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
              return blob.content;
            }))))
  );

  // TODO: wow audit-logging this is expensive.
  // TODO: adding client audit log processing here really complicates this entire path.
  service.post(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments/:name',
    endpoint(({ Audit, Blob, ClientAudit, Project, SubmissionAttachment, SubmissionDef }, { params, headers, auth }, request) =>
      Promise.all([
        Project.getById(params.projectId)
          .then(getOrNotFound)
          .then((project) => auth.canOrReject('submission.update', project)
            .then(() => Promise.all([
              project.getFormByXmlFormId(params.formId) // just for audit logging
                .then(getOrNotFound),
              SubmissionDef.getCurrentByIds(project.id, params.formId, params.instanceId)
                .then(getOrNotFound)
                .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, params.name)
                  .then(getOrNotFound)
                  .then((oldAttachment) => [ def, oldAttachment ]))
            ]))),
        Blob.fromStream(request, headers['content-type'])
          .then((blob) => blob.create())
      ])
        .then(([ [ form, [ def, oldAttachment ] ], blob ]) => Promise.all([
          (oldAttachment.isClientAudit === true)
            // TODO: this entire branch is a terrible compromise.
            ? ClientAudit.attach(blob, () => streamFromBuffer(blob.content))
              .then(def.attach(params.name))
              .then(always(true))
            : def.attach(params.name, blob.id),
          Audit.log(auth.actor(), 'submission.attachment.update', form, {
            instanceId: params.instanceId,
            submissionDefId: def.id,
            name: params.name,
            oldBlobId: oldAttachment.blobId,
            newBlobId: blob.id
          })
        ]))
        .then(([ wasSuccessful ]) => (wasSuccessful
          ? success()
          // should only be a Resolve[False] if everything worked but there wasn't a row to update.
          : reject(Problem.user.notFound()))))
  );

  service.delete(
    '/projects/:projectId/forms/:formId/submissions/:instanceId/attachments/:name',
    endpoint(({ Audit, Project, SubmissionAttachment, SubmissionDef }, { params, auth }) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('submission.update', project)
          .then(() => Promise.all([
            project.getFormByXmlFormId(params.formId)
              .then(getOrNotFound),
            SubmissionDef.getCurrentByIds(project.id, params.formId, params.instanceId)
              .then(getOrNotFound)
          ])))
        .then(([ form, def ]) =>
          SubmissionAttachment.getBySubmissionDefIdAndName(def.id, params.name)
            .then(getOrNotFound)
            .then((attachment) => Promise.all([
              attachment.clear(),
              Audit.log(auth.actor(), 'submission.attachment.update', form, {
                instanceId: params.instanceId,
                submissionDefId: def.id,
                name: attachment.name,
                oldBlobId: attachment.blobId
              })
            ])))
        .then(success))
  );
};

