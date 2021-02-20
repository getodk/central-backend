// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { createReadStream } = require('fs');
const { always, identity } = require('ramda');
const sanitize = require('sanitize-filename');
const { Blob, Form, Submission } = require('../model/frames');
const { createdMessage } = require('../formats/openrosa');
const { getOrNotFound, getOrReject, rejectIf, reject } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { success, xml, isFalse } = require('../util/http');
const Problem = require('../util/problem');
const { streamBriefcaseCsvs } = require('../data/briefcase');
const { streamAttachments } = require('../data/attachments');
const { streamClientAudits } = require('../data/client-audits');
const { isBlank, noargs } = require('../util/util');
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

// util funcs for openRosaSubmission below, mostly just moving baked logic/data off for perf.
const missingXmlProblem = Problem.user.missingMultipartField({ field: 'xml_submission_file' });
const findMultipart = (files) => {
  if (files == null) throw missingXmlProblem;
  for (let i = 0; i < files.length; i += 1)
    if (files[i].fieldname === 'xml_submission_file')
      return files[i];
  throw missingXmlProblem;
};
const forceAuthFailed = Problem.translate(Problem.user.insufficientRights, Problem.user.authenticationFailed);

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
    service.get(path, endpoint.openRosa(({ Projects }, { params }) =>
      Projects.getById(params.projectId)
        .then(getOrNotFound)
        .then(always({ code: 204, body: '' }))));

    // Nonstandard REST; OpenRosa-specific API.
    service.post(path, multipart.any(), endpoint.openRosa(({ Forms, Submissions, SubmissionAttachments }, { params, files, auth, query }) =>
      Submission.fromXml(createReadStream(findMultipart(files).path))
        .then((partial) => getForm(auth, params, partial.xmlFormId, Forms, partial.def.version)
          .catch(forceAuthFailed)
          .then((form) => {
            const deprecatedId = partial.deprecatedId.orNull();
            return (deprecatedId != null)
              // ((found a deprecatedId))
              ? Submissions.getAnyDefByFormAndInstanceId(form.id, deprecatedId, draft)
                .then(getOrReject(Problem.user.deprecatedIdNotFound({ deprecatedId })))
                .then((deprecated) => ((deprecated.current !== true)
                  // (even if deprecated is not current, if it is still n-1 we should allow upsert on it.
                  // so, we get the instanceId referenced as the usurping id and see if /that/ is current.)
                  ? Submissions.getAnyDefByFormAndInstanceId(form.id, partial.instanceId, draft)
                    .then((maybeUsurper) => {
                      const usurper = maybeUsurper.orNull();
                      if ((usurper == null) || (usurper.current !== true))
                        throw Problem.user.deprecatingOldSubmission({ deprecatedId });
                      // EDITED SUBMISSION ATTACHMENT UPSERT REQUEST: check safety then do that.
                      if (Buffer.compare(Buffer.from(partial.xml), Buffer.from(usurper.xml)) !== 0)
                        throw Problem.user.xmlConflict();
                      return SubmissionAttachments.upsert(usurper, files);
                    })
                  // SUBMISSION EDIT REQUEST: find the now-deprecated submission and supplant it.
                  : Promise.all([
                    Submissions.createVersion(partial, deprecated, form),
                    Forms.getBinaryFields(form.def.id)
                  ]).then(([ saved, binaryFields ]) =>
                    SubmissionAttachments.create(partial.withAux('def', saved), form, binaryFields, files))))

              // ((no deprecatedId given))
              : Submissions.getAnyDefByFormAndInstanceId(form.id, partial.instanceId, draft)
                .then((maybeExtant) => {
                  const extant = maybeExtant.orNull();
                  if (extant != null) {
                    // ATTACHMENT UPSERT REQUEST: check safety and add attachments to the extant def.
                    if (extant.current !== true) throw Problem.user.versionDeprecated({ instanceId: partial.instanceId });
                    if (Buffer.compare(Buffer.from(partial.xml), Buffer.from(extant.xml)) !== 0) throw Problem.user.xmlConflict();
                    return SubmissionAttachments.upsert(extant, files);
                  }
                  // NEW SUBMISSION REQUEST: create a new submission and attachments.
                  return Promise.all([
                    Submissions.createNew(partial, form, query.deviceID),
                    Forms.getBinaryFields(form.def.id)
                  ]).then(([ saved, binaryFields ]) => SubmissionAttachments.create(saved, form, binaryFields, files));
                });
          })
          .then(always(createdMessage({ message: 'full submission upload was successful!' }))))));
  };

  // default per-project submission path:
  openRosaSubmission('/projects/:projectId/submission', false, (auth, { projectId }, xmlFormId, Forms, version) =>
    Forms.getByProjectAndXmlFormId(projectId, xmlFormId, false, version)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(rejectIf(((form) => !form.acceptsSubmissions()), noargs(Problem.user.notAcceptingSubmissions)))
      .then((form) => auth.canOrReject('submission.create', form)));

  // draft-testing submission path:
  // TODO: do we even bother maintaining this?
  openRosaSubmission('/projects/:projectId/forms/:xmlFormId/draft/submission', true, (auth, params, xmlFormId, Forms) => {
    if (params.xmlFormId !== xmlFormId)
      return reject(Problem.user.unexpectedValue({ field: 'form id', value: xmlFormId, reason: 'did not match the form ID in the URL' }));

    return Forms.getByProjectAndXmlFormId(params.projectId, xmlFormId, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then((form) => auth.canOrReject('submission.create', form));
  });

  // token-based draft-testing submission path:
  openRosaSubmission('/test/:key/projects/:projectId/forms/:xmlFormId/draft/submission', true, (_, params, xmlFormId, Forms) => {
    if (params.xmlFormId !== xmlFormId)
      return reject(Problem.user.unexpectedValue({ field: 'form id', value: xmlFormId, reason: 'did not match the form ID in the URL' }));

    return Forms.getByProjectAndXmlFormId(params.projectId, xmlFormId, false, Form.DraftVersion)
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
    service.post(path, endpoint(({ Forms, Submissions, SubmissionAttachments }, { params, auth }, request) =>
      Submission.fromXml(request)
        .then((partial) => getForm(params, Forms, partial.def.version)
          .then((form) => auth.canOrReject('submission.create', form))
          .then((form) => {
            if (partial.xmlFormId !== params.formId)
              return reject(Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' }));

            return Promise.all([
              Submissions.createNew(partial, form),
              Forms.getBinaryFields(form.def.id)
            ])
              .then(([ submission, binaryFields ]) =>
                SubmissionAttachments.create(submission, form, binaryFields)
                  .then(always(submission)));
          }))));
  };

  restSubmission('/projects/:projectId/forms/:formId/submissions', ({ projectId, formId }, Forms, version) =>
    Forms.getByProjectAndXmlFormId(projectId, formId, false, version) // TODO: okay so this is exactly the same as the func above..
      .then(getOrNotFound)
      .then(ensureDef)
      .then(rejectIf(
        (form) => !form.acceptsSubmissions(),
        () => Problem.user.notAcceptingSubmissions()
      )));

  restSubmission('/projects/:projectId/forms/:formId/draft/submissions', ({ projectId, formId }, Forms) =>
    Forms.getByProjectAndXmlFormId(projectId, formId, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef));


  const dataOutputs = (base, draft, getForm) => {

    ////////////////////////////////////////
    // CSVZIP EXPORT
    // TODO: as always, a lil repetitive. but it sure seems like a total nightmare
    // to merge these pieces of code?

    const fullzip = ({ ClientAudits, Keys, Forms, SubmissionAttachments, Submissions },
      auth, params, query, passphrases, response) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => {
          const keys = Object.keys(passphrases);
          const options = QueryOptions.fromSubmissionCsvRequest(query);
          return Promise.all([
            Forms.getFields(form.def.id),
            Submissions.streamForExport(form.id, draft, keys, options),
            SubmissionAttachments.streamForExport(form.id, draft, keys, options),
            ClientAudits.streamForExport(form.id, draft, options),
            Keys.getDecryptor(passphrases)
          ]).then(([ fields, rows, attachments, clientAudits, decryptor ]) => {
            const filename = sanitize(form.xmlFormId);
            response.append('Content-Disposition', `attachment; filename="${filename}.zip"`);
            response.append('Content-Type', 'application/zip');
            return zipStreamFromParts(
              streamBriefcaseCsvs(rows, fields, form.xmlFormId, decryptor),
              streamAttachments(attachments, decryptor),
              streamClientAudits(clientAudits, form)
            );
          });
        });

    const csv = ({ Keys, Forms, Submissions }, auth, params, query, passphrases, response, rootOnly) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Promise.all([
          Forms.getFields(form.def.id),
          Submissions.streamForExport(form.id, draft, Object.keys(passphrases), QueryOptions.fromSubmissionCsvRequest(query)),
          Keys.getDecryptor(passphrases)
        ]).then(([ fields, rows, decryptor ]) => {
          const filename = sanitize(form.xmlFormId);
          const extension = (rootOnly === true) ? 'csv' : 'csv.zip';
          response.append('Content-Disposition', `attachment; filename="${filename}.${extension}"`);
          response.append('Content-Type', (rootOnly === true) ? 'text/csv' : 'application/zip');
          const envelope = (rootOnly === true) ? identity : zipStreamFromParts;
          return envelope(streamBriefcaseCsvs(rows, fields, form.xmlFormId, decryptor, rootOnly));
        }));

    // little utility to take nonintegers out of the queryblob, so we only have passphrases.
    const getPassphrases = (query) => {
      const result = {};
      for (const key of Object.keys(query)) if (/^\d+$/.test(key)) result[key] = query[key];
      return result;
    };

    // now we set up three actual endpoints. the first block handles both zipfile versions:
    // with and without media attachments. the second block handles the plain csv output.
    const select = (query) => (isFalse(query.attachments) ? csv : fullzip);
    service.get(`${base}.csv.zip`, endpoint((container, { params, auth, query }, _, response) =>
      select(query)(container, auth, params, query, getPassphrases(query), response)));
    service.post(`${base}.csv.zip`, formParser, endpoint((container, { params, auth, body, query }, _, response) =>
      select(query)(container, auth, params, query, getPassphrases(body), response)));

    service.get(`${base}.csv`, endpoint((container, { params, auth, query }, _, response) =>
      csv(container, auth, params, query, getPassphrases(query), response, true)));
    service.post(`${base}.csv`, formParser, endpoint((container, { params, auth, body, query }, _, response) =>
      csv(container, auth, params, query, getPassphrases(body), response, true)));

    // CSVZIP EXPORT
    ////////////////////////////////////////

    // TODO: paging.
    service.get(base, endpoint(({ Forms, Submissions }, { params, auth, queryOptions }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.list', form))
        .then((form) => Submissions.getAllByFormId(form.id, draft, queryOptions))));

    service.get(`${base}/keys`, endpoint(({ Keys, Forms }, { params, auth }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Keys.getActiveByFormId(form.id, draft))));

    service.get(`${base}/submitters`, endpoint(({ Forms }, { params, auth }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Forms.getAllSubmitters(form.id))));

    service.get(`${base}/:instanceId.xml`, endpoint(({ Forms, Submissions }, { params, auth }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Submissions.getCurrentDefByIds(form.projectId, form.xmlFormId, params.instanceId, draft))
        .then(getOrNotFound)
        .then((def) => xml(def.xml))));

    service.get(`${base}/:instanceId`, endpoint(({ Forms, Submissions }, { params, auth, queryOptions }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Submissions.getById(form.id, params.instanceId, draft, queryOptions))
        .then(getOrNotFound)));

    ////////////////////////////////////////////////////////////////////////////////
    // SUBMISSION ATTACHMENTS
    // TODO: a lot of layers to select through one at a time. eventually make more efficient.

    service.get(`${base}/:instanceId/attachments`, endpoint(({ Forms, Submissions, SubmissionAttachments }, { params, auth }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Submissions.getCurrentDefByIds(form.projectId, form.xmlFormId, params.instanceId, draft))
        .then(getOrNotFound)
        .then((def) => SubmissionAttachments.getAllByDefId(def.id))));

    service.get(
      `${base}/:instanceId/attachments/:name`,
      endpoint(({ Blobs, Forms, SubmissionAttachments, Submissions }, { params, auth }, _, response) =>
        getForm(params, Forms)
          .then((form) => auth.canOrReject('submission.read', form))
          .then((form) => Submissions.getCurrentDefByIds(form.projectId, form.xmlFormId, params.instanceId, draft))
          .then(getOrNotFound)
          .then((def) => SubmissionAttachments.getBySubmissionDefIdAndName(def.id, params.name))
          .then(getOrNotFound)
          .then((attachment) => Blobs.getById(attachment.blobId)
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
      endpoint(({ Audits, Blobs, Forms, SubmissionAttachments, Submissions }, { params, headers, auth }, request) =>
        Promise.all([
          getForm(params, Forms)
            .then((form) => auth.canOrReject('submission.update', form))
            .then((form) => Submissions.getCurrentDefByIds(form.projectId, form.xmlFormId, params.instanceId, draft)
              .then(getOrNotFound)
              .then((def) => SubmissionAttachments.getBySubmissionDefIdAndName(def.id, params.name) // just for audit logging
                .then(getOrNotFound)
                .then((oldAttachment) => [ form, def, oldAttachment ]))),
          Blob.fromStream(request, headers['content-type']).then(Blobs.ensure)
        ])
          .then(([ [ form, def, oldAttachment ], blobId ]) => Promise.all([
            SubmissionAttachments.attach(def, params.name, blobId),
            Audits.log(auth.actor, 'submission.attachment.update', form, {
              instanceId: params.instanceId,
              submissionDefId: def.id,
              name: params.name,
              oldBlobId: oldAttachment.blobId,
              newBlobId: blobId
            })
          ]))
          .then(([ wasSuccessful ]) => (wasSuccessful
            ? success()
            // should only be a Resolve[False] if everything worked but there wasn't a row to update.
            : reject(Problem.user.notFound()))))
    );

    service.delete(
      `${base}/:instanceId/attachments/:name`,
      endpoint(({ Forms, SubmissionAttachments, Submissions }, { params, auth }) =>
        getForm(params, Forms)
          .then((form) => auth.canOrReject('submission.update', form))
          .then((form) => Submissions.getCurrentDefByIds(form.projectId, form.xmlFormId, params.instanceId, draft)
            .then(getOrNotFound)
            .then((def) => SubmissionAttachments.getBySubmissionDefIdAndName(def.id, params.name)
              .then(getOrNotFound)
              .then((attachment) => SubmissionAttachments.clear(attachment, form, params.instanceId))))
          .then(success))
    );

  };

  // reify for draft/nondraft
  dataOutputs('/projects/:projectId/forms/:formId/submissions', false, (params, Forms) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.formId)
      .then(getOrNotFound));

  dataOutputs('/projects/:projectId/forms/:formId/draft/submissions', true, (params, Forms) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.formId, undefined, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef));
};

