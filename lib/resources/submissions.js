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
const { getOrNotFound, resolve, getOrReject, rejectIf, reject, ignoringResult } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { success, xml } = require('../util/http');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { streamBriefcaseCsvs } = require('../data/briefcase');
const { streamAttachments } = require('../data/attachments');
const { streamClientAudits } = require('../data/client-audits');
const { isBlank } = require('../util/util');
const { zipStreamFromParts } = require('../util/zip');

// multipart things:
const multer = require('multer');
const tmpdir = require('tmp').dirSync();
const multipart = multer({ dest: tmpdir.name });

// formbody things:
const bodyParser = require('body-parser');
const formParser = bodyParser.urlencoded({ extended: false });

// util func to ensure the form we fetched successfully joined to the intended def.
// TODO: copied from resources/forms
const ensureDef = rejectIf(((form) => form.def.id == null), () => Problem.user.notFound());

module.exports = (service, endpoint) => {

  ////////////////////////////////////////////////////////////////////////////////
  // SUBMISSIONS (OPENROSA)

  const openRosaSubmission = (path, draft, getForm) => {
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
    service.get(path, endpoint(({ Project }, { params }, request, response) =>
      Project.getById(params.projectId)
        .then(getOrNotFound)
        .then(() => { response.status(204); })));

    // Nonstandard REST; OpenRosa-specific API.
    service.post(path, multipart.any(), endpoint.openRosa(({ Audit, Form, Submission, SubmissionAttachment, SubmissionPartial }, { params, files, auth, query }) =>
      // first, process the submission xml.
      resolve(Option.of(files).map((xs) => xs.find((file) => file.fieldname === 'xml_submission_file')))
        .then(getOrReject(Problem.user.missingMultipartField({ field: 'xml_submission_file' })))
        .then((file) => SubmissionPartial.fromXml(createReadStream(file.path)))
        // now we have the information we need to get the correct form; do so
        // and make sure we can actually submit to it.
        .then((partial) => getForm(auth, params, partial.xmlFormId, Form, partial.version)
          // for openrosa endpoints, we must return 401 rather than 403.
          .catch(Problem.translate(Problem.user.insufficientRights, Problem.user.authenticationFailed))
          .then((form) => Promise.all([
            Submission.getById(form.id, partial.instanceId, draft, QueryOptions.extended),
            form.def.getBinaryFields()
          ])
            // we branch based on whether a submission already existed; in either case, we exit this
            // branching promise path with a Promise[Submission] that is complete (eg with an id).
            .then(([ maybeExtant, binaryFields ]) => maybeExtant
              // if a submission already exists, first verify that the posted xml still matches
              // (if it does not, reject). then, attach any new posted files.
              .map((extant) => extant.getCurrentVersion() // TODO: save this extra request?
                .then(getOrNotFound) // TODO: sort of a goofy bailout case.
                .then((extantVersion) => ((Buffer.compare(Buffer.from(extantVersion.xml), Buffer.from(partial.xml)) !== 0)
                  ? reject(Problem.user.xmlConflict())
                  : extantVersion.upsertAttachments(files))))
              // otherwise, this is the first POST for this submission. create the
              // submission and the expected attachments:
              .orElseGet(() => partial.createAll(form, auth.actor(), query.deviceID)
                .then(ignoringResult(({ submission, submissionDef }) =>
                  submissionDef.generateExpectedAttachments(binaryFields, files)
                    .then((attachments) => Promise.all([
                      SubmissionAttachment.createAll(attachments),
                      Audit.logAll(attachments
                        .filter((a) => a.blobId != null)
                        .map((attachment) => Audit.of(auth.actor(), 'submission.attachment.update', form, {
                          instanceId: submission.instanceId,
                          submissionDefId: submissionDef.id,
                          name: attachment.name,
                          newBlobId: attachment.blobId
                        })))
                    ])))))
              // now we have a definite submission; we just need to do audit logging.
              .then((submission) => Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id, instanceId: submission.instanceId }))
              // TODO: perhaps actually decide between "full" and "partial"; aggregate does this.
              .then(always(createdMessage({ message: 'full submission upload was successful!' }))))))));
  };

  // default per-project submission path:
  openRosaSubmission('/projects/:projectId/submission', false, (auth, { projectId }, xmlFormId, Form, version) =>
    Form.getByProjectAndXmlFormId(projectId, xmlFormId, undefined, version)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(rejectIf(
        (form) => !form.acceptsSubmissions(),
        () => Problem.user.notAcceptingSubmissions()
      ))
      .then((form) => auth.canOrReject('submission.create', form)));

  // draft-testing submission path:
  // TODO: do we even bother maintaining this?
  openRosaSubmission('/projects/:projectId/forms/:xmlFormId/draft/submission', true, (auth, params, xmlFormId, Form) => {
    if (params.xmlFormId !== xmlFormId)
      return reject(Problem.user.unexpectedValue({ field: 'form id', value: xmlFormId, reason: 'did not match the form ID in the URL' }));

    return Form.getByProjectAndXmlFormId(params.projectId, xmlFormId, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef)
      .then((form) => auth.canOrReject('submission.create', form));
  });

  // token-based draft-testing submission path:
  openRosaSubmission('/test/:key/projects/:projectId/forms/:xmlFormId/draft/submission', true, (_, params, xmlFormId, Form) => {
    if (params.xmlFormId !== xmlFormId)
      return reject(Problem.user.unexpectedValue({ field: 'form id', value: xmlFormId, reason: 'did not match the form ID in the URL' }));

    return Form.getByProjectAndXmlFormId(params.projectId, xmlFormId, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef)
      .then(rejectIf(
        ((form) => (params.key !== form.def.draftToken) || isBlank(form.def.draftToken)),
        () => Problem.user.notFound()
      ));
  });


  ////////////////////////////////////////////////////////////////////////////////
  // SUBMISSIONS (STANDARD REST)

  // The remaining endpoints follow a more-standard REST subresource route pattern.
  // This first one performs the operation as the above. the rest are genericized
  // and repeated for draft/nondraft.

  const restSubmission = (path, getForm) => {
    service.post(path, endpoint(({ Audit, Form, SubmissionAttachment, SubmissionPartial }, { params, auth }, request) =>
      SubmissionPartial.fromXml(request)
        .then((partial) => getForm(params, Form, partial.version)
          .then((form) => auth.canOrReject('submission.create', form))
          .then((form) => {
            if (partial.xmlFormId !== params.formId)
              return reject(Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' }));

            return Promise.all([
              partial.createAll(form, auth.actor()),
              form.def.getBinaryFields()
            ])
              .then(([{ submission, submissionDef }, binaryFields]) => Promise.all([
                submissionDef.generateExpectedAttachments(binaryFields)
                  .then((attachments) => SubmissionAttachment.createAll(attachments)),
                Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id, instanceId: submission.instanceId })
              ])
                .then(always(submission)));
          }))));
  };

  restSubmission('/projects/:projectId/forms/:formId/submissions', ({ projectId, formId }, Form, version) =>
    Form.getByProjectAndXmlFormId(projectId, formId, undefined, version) // TODO: okay so this is exactly the same as the func above..
      .then(getOrNotFound)
      .then(ensureDef)
      .then(rejectIf(
        (form) => !form.acceptsSubmissions(),
        () => Problem.user.notAcceptingSubmissions()
      )));

  restSubmission('/projects/:projectId/forms/:formId/draft/submissions', ({ projectId, formId }, Form) =>
    Form.getByProjectAndXmlFormId(projectId, formId, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef));


  const dataOutputs = (base, draft, getForm) => {

    ////////////////////////////////////////
    // CSVZIP EXPORT

    const csvzip = ({ ClientAudit, Key, Form, SubmissionAttachment, SubmissionDef },
      auth, params, passphraseData, response) =>
      getForm(params, Form)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Promise.all([
          form.def.getFields(),
          SubmissionDef.streamForExport(form.id, draft, Object.keys(passphraseData)),
          SubmissionAttachment.streamForExport(form.id, draft, Object.keys(passphraseData)), // TODO: repetitive
          ClientAudit.streamForExport(form.id, draft),
          Key.getDecryptor(map(decodeURIComponent, passphraseData)) // will do nothing if {}
        ]).then(([ fields, rows, attachments, clientAudits, decryptor ]) => {
          const filename = sanitize(form.xmlFormId);
          response.append('Content-Disposition', `attachment; filename="${filename}.zip"`);
          response.append('Content-Type', 'application/zip');
          return zipStreamFromParts(
            streamBriefcaseCsvs(rows, fields, form.xmlFormId, decryptor),
            streamAttachments(attachments, decryptor),
            streamClientAudits(clientAudits, form)
          );
        }));

    service.get(`${base}.csv.zip`, endpoint((container, { params, auth, query }, _, response) =>
      csvzip(container, auth, params, query, response)));

    service.post(`${base}.csv.zip`, formParser, endpoint((container, { params, auth, body }, _, response) =>
      csvzip(container, auth, params, body, response)));

    // CSVZIP EXPORT
    ////////////////////////////////////////

    // TODO: paging.
    service.get(base, endpoint(({ Form, Submission }, { params, auth, queryOptions }) =>
      getForm(params, Form)
        .then((form) => auth.canOrReject('submission.list', form))
        .then((form) => Submission.getAllByFormId(form.id, draft, queryOptions))));

    service.get(`${base}/keys`, endpoint(({ Key, Form }, { params, auth }) =>
      getForm(params, Form)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Key.getActiveByFormId(form.id, draft))));

    service.get(`${base}/:instanceId.xml`, endpoint(({ Form, SubmissionDef }, { params, auth }) =>
      getForm(params, Form)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => SubmissionDef.getCurrentByIds(form.projectId, form.xmlFormId, params.instanceId, draft))
        .then(getOrNotFound)
        .then((def) => xml(def.xml))));

    service.get(`${base}/:instanceId`, endpoint(({ Form, Submission }, { params, auth, queryOptions }) =>
      getForm(params, Form)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Submission.getById(form.id, params.instanceId, draft, queryOptions))
        .then(getOrNotFound)));

    ////////////////////////////////////////////////////////////////////////////////
    // SUBMISSION ATTACHMENTS
    // TODO: a lot of layers to select through one at a time. eventually make more efficient.

    service.get(`${base}/:instanceId/attachments`, endpoint(({ Form, SubmissionDef }, { params, auth }) =>
      getForm(params, Form)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => SubmissionDef.getCurrentByIds(form.projectId, form.xmlFormId, params.instanceId, draft))
        .then(getOrNotFound)
        .then((def) => def.getAttachmentMetadata())));

    service.get(
      `${base}/:instanceId/attachments/:name`,
      endpoint(({ Blob, Form, SubmissionAttachment, SubmissionDef }, { params, auth }, _, response) =>
        getForm(params, Form)
          .then((form) => auth.canOrReject('submission.read', form))
          .then((form) => SubmissionDef.getCurrentByIds(form.projectId, form.xmlFormId, params.instanceId, draft))
          .then(getOrNotFound)
          .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, params.name))
          .then(getOrNotFound)
          .then((attachment) => Blob.getById(attachment.blobId)
            .then(getOrNotFound)
            .then((blob) => {
              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
              return blob.content;
            })))
    );

    // TODO: wow audit-logging this is expensive.
    service.post(
      `${base}/:instanceId/attachments/:name`,
      endpoint(({ Audit, Blob, Form, SubmissionAttachment, SubmissionDef }, { params, headers, auth }, request) =>
        Promise.all([
          getForm(params, Form)
            .then((form) => auth.canOrReject('submission.update', form))
            .then((form) => SubmissionDef.getCurrentByIds(form.projectId, form.xmlFormId, params.instanceId, draft)
              .then(getOrNotFound)
              .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, params.name) // just for audit logging
                .then(getOrNotFound)
                .then((oldAttachment) => [ form, def, oldAttachment ]))),
          Blob.fromStream(request, headers['content-type'])
            .then((blob) => blob.ensure())
        ])
          .then(([ [ form, def, oldAttachment ], blob ]) => Promise.all([
            def.attach(params.name, blob),
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
      `${base}/:instanceId/attachments/:name`,
      endpoint(({ Audit, Form, SubmissionAttachment, SubmissionDef }, { params, auth }) =>
        getForm(params, Form)
          .then((form) => auth.canOrReject('submission.update', form))
          .then((form) => SubmissionDef.getCurrentByIds(form.projectId, form.xmlFormId, params.instanceId, draft)
            .then(getOrNotFound)
            .then((def) => SubmissionAttachment.getBySubmissionDefIdAndName(def.id, params.name)
              .then(getOrNotFound)
              .then((attachment) => Promise.all([
                attachment.clear(),
                Audit.log(auth.actor(), 'submission.attachment.update', form, {
                  instanceId: params.instanceId,
                  submissionDefId: def.id,
                  name: attachment.name,
                  oldBlobId: attachment.blobId
                })
              ]))))
          .then(success))
    );

  };

  // reify for draft/nondraft
  dataOutputs('/projects/:projectId/forms/:formId/submissions', false, (params, Form) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.formId)
      .then(getOrNotFound));

  dataOutputs('/projects/:projectId/forms/:formId/draft/submissions', true, (params, Form) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.formId, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef));
};

