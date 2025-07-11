// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { always, identity } = require('ramda');
const multer = require('multer');
const sanitize = require('sanitize-filename');
const { Blob, Form, Submission } = require('../model/frames');
const { ensureDef } = require('../model/frame');
const { createdMessage } = require('../formats/openrosa');
const { getOrNotFound, getOrReject, rejectIf, reject } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { success, xml, isFalse, contentDisposition, redirect, url } = require('../util/http');
const { blobResponse, defaultMimetypeFor } = require('../util/blob');
const Problem = require('../util/problem');
const { streamBriefcaseCsvs } = require('../data/briefcase');
const { streamAttachments } = require('../data/attachments');
const { streamClientAudits } = require('../data/client-audits');
const { diffSubmissions } = require('../data/submission');
const { resolve } = require('../util/promise');
const { isBlank, noargs } = require('../util/util');
const { zipStreamFromParts } = require('../util/zip');

const XML_SUBMISSION_FILE = 'xml_submission_file';

// multipart things:
const multipart = multer({ storage: multer.memoryStorage() });
// The following errors bubble up through multer from busboy, and are generic Error objects:
const busboyErrors = [
  'Malformed content type',
  'Malformed part header',
  'Malformed urlencoded form',
  'Missing Content-Type',
  'Multipart: Boundary not found',
  'Unexpected end of file',
  'Unexpected end of form',
];
const multipartErrorHandler = (err, req, res, next) => {
  if (busboyErrors.includes(err.message)) {
    next(Problem.user.multipartParsingFailed(err.message));
  } else if (err.message.startsWith('Unsupported content type: ')) {
    next(Problem.user.multipartParsingFailed('Unsupported content type.'));
  } else {
    next(err);
  }
};

// formbody things:
const bodyParser = require('body-parser');
const formParser = bodyParser.urlencoded({ extended: false });

// util funcs for openRosaSubmission below, mostly just moving baked logic/data off for perf.
const missingXmlProblem = Problem.user.missingMultipartField({ field: XML_SUBMISSION_FILE });
const findMultipart = (files) => {
  if (files == null) throw missingXmlProblem;
  for (let i = 0; i < files.length; i += 1)
    if (files[i].fieldname === XML_SUBMISSION_FILE)
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

    // Temporary solution to https://github.com/expressjs/multer/issues/1104
    // Multer uses latin1 encoding for filename and fieldname
    const multerUtf = (request, _, next) => {
      request.files = request.files?.map(f => {
        if (f.fieldname === XML_SUBMISSION_FILE) return f;
        return {
          ...f,
          originalname: Buffer.from(f.originalname, 'latin1').toString('utf8'),
          fieldname: Buffer.from(f.fieldname, 'latin1').toString('utf8')
        };
      });
      next();
    };

    // Nonstandard REST; OpenRosa-specific API.
    service.post(path, multipart.any(), multerUtf, multipartErrorHandler, endpoint.openRosa(({ Forms, Submissions, SubmissionAttachments }, { params, files, auth, query, userAgent }) =>
      Submission.fromXml(findMultipart(files).buffer)
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
                    Forms.getBinaryFields(form.def.id),
                    SubmissionAttachments.getForFormAndInstanceId(form.id, deprecatedId, draft)
                  ]).then(([ saved, binaryFields, deprecatedAtts ]) =>
                    SubmissionAttachments.create(saved.aux.currentVersion.with({ def: saved.aux.currentVersion }), form, binaryFields, files, deprecatedAtts))))

              // ((no deprecatedId given))
              : Submissions.getAnyDefByFormAndInstanceId(form.id, partial.instanceId, draft)
                .then((maybeExtant) => {
                  const extant = maybeExtant.orNull();
                  if (extant != null) {
                    // ATTACHMENT UPSERT REQUEST: check safety and add attachments to the extant def.
                    if (extant.current !== true) throw Problem.user.deprecatingOldSubmission({ instanceId: partial.instanceId });
                    if (Buffer.compare(Buffer.from(partial.xml), Buffer.from(extant.xml)) !== 0) throw Problem.user.xmlConflict();
                    return SubmissionAttachments.upsert(extant, files);
                  }
                  // NEW SUBMISSION REQUEST: create a new submission and attachments.
                  return Promise.all([
                    Submissions.createNew(partial, form, query.deviceID, userAgent),
                    Forms.getBinaryFields(form.def.id)
                  ])
                    .then(([ saved, binaryFields ]) => SubmissionAttachments.create(saved, form, binaryFields, files))
                    // This is only true when submission is soft deleted, if it is hard deleted then there will no error
                    // and if it is not deleted then `extant` will be not null and this block will not execute.
                    .catch(Problem.translate(Problem.user.uniquenessViolation, noargs(Problem.user.duplicateSubmission)));
                });
          })
          .then(always(createdMessage({ message: 'full submission upload was successful!' }))))));
  };

  // default per-project submission path:
  openRosaSubmission('/projects/:projectId/submission', false, (auth, { projectId }, xmlFormId, Forms, version) =>
    Forms.getByProjectAndXmlFormId(projectId, xmlFormId, false, version)
      .then(getOrNotFound)
      // This replaces ensureDef(form). If the form was found with the project ID and form ID
      // constraints but the def was not found, that suggest the problem was with the version.
      .then(rejectIf(((form) => (form.def.id == null)), () => Problem.user.formVersionNotFound({ formVersion: version })))
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

  const restSubmission = (base, draft, getForm) => {
    service.post(`${base}/submissions`, endpoint(({ Forms, Submissions, SubmissionAttachments }, { params, auth, query, userAgent }, request) =>
      Submission.fromXml(request)
        .then((partial) => getForm(params, Forms, partial.def.version)
          .then((form) => auth.canOrReject('submission.create', form))
          .then((form) => {
            if (partial.xmlFormId !== params.formId)
              return reject(Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' }));

            return Promise.all([
              Submissions.createNew(partial, form, query.deviceID, userAgent),
              Forms.getBinaryFields(form.def.id)
            ])
              .then(([ submission, binaryFields ]) =>
                SubmissionAttachments.create(submission, form, binaryFields)
                  .then(always(submission)));
          }))));

    service.put(`${base}/submissions/:instanceId`, endpoint(({ Forms, Submissions, SubmissionAttachments }, { params, auth, query, userAgent }, request) =>
      Submission.fromXml(request).then((partial) => {
        if (partial.xmlFormId !== params.formId)
          return reject(Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' }));
        const deprecatedId = partial.deprecatedId.orElseGet(() => { throw Problem.user.expectedDeprecation(); });
        return Promise.all([
          // TODO/PERF: a bespoke query here could save some round-trips
          Submissions.getCurrentDefColsByIds(['instanceId', 'submissionId'], params.projectId, params.formId, params.instanceId, draft)
            .then(getOrNotFound)
            .then(rejectIf(((current) => current.instanceId !== deprecatedId),
              () => Problem.user.deprecatingOldSubmission(({ deprecatedId })))),
          getForm(params, Forms, partial.def.version)
            .then((form) => auth.canOrReject('submission.create', form)),
          Submissions.getByIds(params.projectId, params.formId, params.instanceId, draft)
            .then(getOrNotFound) // this request exists just to check existence and fail the whole request.
        ])
          .then(([ deprecated, form ]) => Promise.all([
            Submissions.createVersion(partial, deprecated, form, query.deviceID, userAgent),
            Forms.getBinaryFields(form.def.id),
            SubmissionAttachments.getForFormAndInstanceId(form.id, deprecatedId, draft),
          ])
            .then(([ submission, binaryFields, deprecatedAtt ]) =>
              SubmissionAttachments.create(submission.aux.currentVersion.with({ def: submission.aux.currentVersion }), form, binaryFields, undefined, deprecatedAtt)
                .then(always(submission))));
      })));
  };

  restSubmission('/projects/:projectId/forms/:formId', false, ({ projectId, formId }, Forms, version) =>
    Forms.getByProjectAndXmlFormId(projectId, formId, false, version) // TODO: okay so this is exactly the same as the func above..
      .then(getOrNotFound)
      // This replaces ensureDef(form). If the form was found with the project ID and form ID
      // constraints but the def was not found, that suggest the problem was with the version.
      .then(rejectIf(((form) => (form.def.id == null)), () => Problem.user.formVersionNotFound({ formVersion: version })))
      .then(rejectIf(
        (form) => !form.acceptsSubmissions(),
        () => Problem.user.notAcceptingSubmissions()
      )));

  restSubmission('/projects/:projectId/forms/:formId/draft', true, ({ projectId, formId }, Forms) =>
    Forms.getByProjectAndXmlFormId(projectId, formId, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef));

  const checkFormToken = (token) => rejectIf(
    ((form) => (form.def.draftToken !== token) || isBlank(form.def.draftToken)),
    noargs(Problem.user.notFound)
  );

  // Create Submission using draftToken
  service.post(`/test/:key/projects/:projectId/forms/:formId/draft/submissions`, endpoint(({ Forms, Submissions, SubmissionAttachments }, { params, query, userAgent }, request) =>
    Submission.fromXml(request)
      .then((partial) => Forms.getByProjectAndXmlFormId(params.projectId, params.formId, false, Form.DraftVersion)
        .then(getOrNotFound)
        .then(ensureDef)
        .then(checkFormToken(params.key))
        .then((form) => {
          if (partial.xmlFormId !== params.formId)
            return reject(Problem.user.unexpectedValue({ field: 'form id', value: partial.xmlFormId, reason: 'did not match the form ID in the URL' }));

          return Promise.all([
            Submissions.createNew(partial, form, query.deviceID, userAgent),
            Forms.getBinaryFields(form.def.id)
          ])
            .then(([ submission, binaryFields ]) =>
              SubmissionAttachments.create(submission, form, binaryFields)
                .then(always(submission)));
        }))));

  ////////////////////////////////////////////////////////////////////////////////
  // SUBMISSION EDIT / UPDATE

  service.get('/projects/:projectId/forms/:formId/submissions/:instanceId/edit', endpoint(({ Forms, Submissions, SubmissionAttachments, enketo, env }, { params, auth }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.formId, false)
      .then(getOrNotFound)
      .then(auth.canOrReject('submission.update'))
      // we could theoretically wire up the pushFormToEnketo routine here, under a manual
      // transaction. but it doesn't feel like this case is likely to ever be hit. so just
      // reject if we haven't pushed to enketo for .. some probably bad unrelated reason.
      .then(rejectIf(((form) => form.enketoId == null), noargs(Problem.user.enketoNotReady)))
      .then(rejectIf(((form) => form.state !== 'open'), noargs(Problem.user.editingClosingOrClosed)))
      .then((form) => Submissions.getCurrentDefByIds(params.projectId, params.formId, params.instanceId, false)
        .then(getOrNotFound)
        .then((def) => SubmissionAttachments.getCurrentForSubmissionId(form.id, def.submissionId, false)
          .then((attachments) => (form.webformsEnabled ? `${env.domain}/projects/${form.projectId}/forms/${form.xmlFormId}/submissions/${params.instanceId}/edit` : enketo.edit(
            `${env.domain}/v1/projects/${form.projectId}`,
            env.domain, form, params.instanceId, def, attachments, auth.session.map((s) => s.token).orNull()
          ))))
        .then(redirect(302)))));

  service.patch('/projects/:projectId/forms/:formId/submissions/:instanceId', endpoint(({ Forms, Submissions }, { params, auth, body }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.formId, false)
      .then(getOrNotFound)
      .then(auth.canOrReject('submission.update'))
      .then((form) => Submissions.getByIdsWithDef(params.projectId, params.formId, params.instanceId, false)
        .then(getOrNotFound)
        .then((submission) => Submissions.update(form, submission, Submission.fromApi(body))))));

  service.delete('/projects/:projectId/forms/:formId/submissions/:instanceId', endpoint(async ({ Forms, Submissions }, { params, auth }) => {
    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.formId, false).then(getOrNotFound);
    await auth.canOrReject('submission.delete', form);
    const submission = await Submissions.getByIdsWithDef(params.projectId, params.formId, params.instanceId, false).then(getOrNotFound);
    await Submissions.del(submission, form);
    return success();
  }));

  service.post('/projects/:projectId/forms/:formId/submissions/:instanceId/restore', endpoint(async ({ Forms, Submissions }, { params, auth }) => {
    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.formId, false).then(getOrNotFound);
    await auth.canOrReject('submission.restore', form);
    const submission = await Submissions.getDeleted(params.projectId, form.id, params.instanceId).then(getOrNotFound);
    await Submissions.restore(submission, form);
    return success();
  }));


  const dataOutputs = (base, draft, getForm) => {

    ////////////////////////////////////////
    // CSVZIP EXPORT
    // TODO: as always, a lil repetitive. but it sure seems like a total nightmare
    // to merge these pieces of code?

    const fullzip = ({ Audits, ClientAudits, Keys, Forms, SubmissionAttachments, Submissions },
      auth, params, query, passphrases, response) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        // we fetch and validate our passphrases first, so that we don't leave
        // hanging query streams we have to clean up in case of a bad passphrase.
        .then((form) => Keys.getDecryptor(passphrases)
          .then((decryptor) => {
            const keys = Object.keys(passphrases);
            const options = QueryOptions.fromSubmissionCsvRequest(query);
            return Promise.all([
              (options.deletedFields === true) ? Forms.getMergedFields(form.id) : Forms.getFields(form.def.id),
              Submissions.streamForExport(form.id, draft, keys, options),
              (options.splitSelectMultiples !== true) ? null : Submissions.getSelectMultipleValuesForExport(form.id, draft, options),
              SubmissionAttachments.streamForExport(form.id, draft, keys, options),
              ClientAudits.streamForExport(form.id, draft, keys, options),
              draft ? null : Audits.log(auth.actor, 'form.submission.export', form)
            ]).then(([fields, rows, selectValues, attachments, clientAudits]) => {
              const filename = sanitize(form.xmlFormId);
              response.append('Content-Disposition', contentDisposition(`${filename}.zip`));
              response.append('Content-Type', 'application/zip');
              return zipStreamFromParts(
                // TODO: not 100% sure that these streams close right on crash.
                streamBriefcaseCsvs(rows, fields, form.xmlFormId, selectValues, decryptor, false, options),
                streamAttachments(attachments, decryptor),
                streamClientAudits(clientAudits, form, decryptor)
              );
            });
          }));

    const csv = ({ Audits, Keys, Forms, Submissions },
      auth, params, query, passphrases, response, rootOnly) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => {
          const options = QueryOptions.fromSubmissionCsvRequest(query);
          return Promise.all([
            (options.deletedFields === true) ? Forms.getMergedFields(form.id) : Forms.getFields(form.def.id),
            Submissions.streamForExport(form.id, draft, Object.keys(passphrases), options),
            (options.splitSelectMultiples !== true) ? null : Submissions.getSelectMultipleValuesForExport(form.id, draft, options),
            Keys.getDecryptor(passphrases),
            draft ? null : Audits.log(auth.actor, 'form.submission.export', form)
          ])
            .then(([fields, rows, selectValues, decryptor]) => {
              const filename = sanitize(form.xmlFormId);
              const extension = (rootOnly === true) ? 'csv' : 'csv.zip';
              response.append('Content-Disposition', contentDisposition(`${filename}.${extension}`));
              response.append('Content-Type', (rootOnly === true) ? 'text/csv' : 'application/zip');
              const envelope = (rootOnly === true) ? identity : zipStreamFromParts;
              return envelope(streamBriefcaseCsvs(rows, fields, form.xmlFormId, selectValues, decryptor, rootOnly, options));
            });
        });

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
        .then((form) => Submissions.getAllForFormByIds(params.projectId, form.xmlFormId, draft, queryOptions))));

    service.get(`${base}/keys`, endpoint(({ Keys, Forms }, { params, auth }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Keys.getActiveByFormId(form.id, draft))));

    service.get(`${base}/submitters`, endpoint(({ Forms }, { params, auth }) =>
      getForm(params, Forms)
        .then((form) => auth.canOrReject('submission.read', form))
        .then((form) => Forms.getAllSubmitters(form.id))));

    service.get(`${base}/:instanceId/audits`, endpoint(({ Audits, Forms, Submissions }, { params, auth, queryOptions }) =>
      getForm(params, Forms)
        .then(auth.canOrReject('submission.read')) // TODO: this could be split to audit.read on form
        .then(() => Submissions.getByIds(params.projectId, params.formId, params.instanceId, draft))
        .then(getOrNotFound)
        .then((submission) => Audits.getBySubmissionId(submission.id, queryOptions))));

    // if we match the logical id, we stick around. otherwise we redirect.
    const getOrRedirect = (Forms, Submissions, { params, auth, originalUrl, queryOptions }) =>
      Promise.all([
        getForm(params, Forms),
        Submissions.getByIds(params.projectId, params.formId, params.instanceId, draft, queryOptions)
      ])
        .then(([ form, maybeSub ]) => Promise.all([
          auth.canOrReject('submission.read', form),
          maybeSub.map(resolve).orElseGet(() =>
            Submissions.getRootForInstanceId(form.id, params.instanceId, draft)
              .then(getOrNotFound)
              .then((rootId) => redirect(originalUrl.replace(
                `/submissions/${params.instanceId}`,
                url`/submissions/${rootId}/versions/${params.instanceId}`
              ))))
        ]));

    service.get(`${base}/:instanceId.xml`, endpoint(({ Forms, Submissions }, context) =>
      getOrRedirect(Forms, Submissions, context)
        .then(() => Submissions.getCurrentDefColByIds('xml', context.params.projectId, context.params.formId, context.params.instanceId, draft))
        .then(getOrNotFound)
        .then((defXml) => xml(defXml))));

    service.get(`${base}/:instanceId`, endpoint(({ Forms, Submissions }, context) =>
      getOrRedirect(Forms, Submissions, context)
        .then(([ , submission ]) => submission)));

    ////////////////////////////////////////////////////////////////////////////////
    // SUBMISSION ATTACHMENTS

    service.get(`${base}/:instanceId/attachments`, endpoint(({ Forms, Submissions, SubmissionAttachments }, context) =>
      getOrRedirect(Forms, Submissions, context)
        .then(([ form, submission ]) => SubmissionAttachments.getCurrentForSubmissionId(form.id, submission.id, draft))));

    service.get(`${base}/:instanceId/attachments/:name`, endpoint(({ s3, Forms, Submissions, SubmissionAttachments }, context) =>
      getOrRedirect(Forms, Submissions, context)
        .then(([ form, submission ]) => SubmissionAttachments.getCurrentBlobByIds(form.id, submission.id, context.params.name, draft))
        .then(getOrNotFound)
        .then((blob) => blobResponse(s3, context.params.name, blob))));

    service.post(
      `${base}/:instanceId/attachments/:name`,
      endpoint(({ Audits, Blobs, Forms, SubmissionAttachments, Submissions }, { params, headers, auth }, request) =>
        Promise.all([
          getForm(params, Forms)
            .then((form) => Submissions.getCurrentDefColByIds('id', form.projectId, form.xmlFormId, params.instanceId, draft)
              .then(getOrNotFound)
              .then((defId) => SubmissionAttachments.getBySubmissionDefIdAndName(defId, params.name) // just for audit logging
                .then(getOrNotFound)
                .then((oldAttachment) => [ form, defId, oldAttachment ]))),
          Blob.fromStream(request, headers['content-type'] || defaultMimetypeFor(params.name)).then(Blobs.ensure)
        ])
          .then(async ([ [ form, defId, oldAttachment ], blobId ]) => {
            const canUpdateSubmissions = await auth.can('submission.update', form);
            if (!canUpdateSubmissions) {
              throw Problem.user.insufficientRights();
            }
            return Promise.all([
              SubmissionAttachments.attach(defId, params.name, blobId),
              Audits.log(auth.actor, 'submission.attachment.update', form, {
                instanceId: params.instanceId,
                submissionDefId: defId,
                name: params.name,
                oldBlobId: oldAttachment.blobId,
                newBlobId: blobId
              })
            ]);
          })
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
          .then((form) => Submissions.getCurrentDefColByIds('id', form.projectId, form.xmlFormId, params.instanceId, draft)
            .then(getOrNotFound)
            .then((defId) => SubmissionAttachments.getBySubmissionDefIdAndName(defId, params.name))
            .then(getOrNotFound)
            .then((attachment) => SubmissionAttachments.clear(attachment, form, params.instanceId)))
          .then(success))
    );

    ////////////////////////////////////////////////////////////////////////////////
    // VERSIONS

    service.get(`${base}/:rootId/versions`, endpoint(({ Forms, Submissions }, { params, auth, queryOptions }) =>
      getForm(params, Forms)
        .then(auth.canOrReject('submission.read'))
        .then((form) => Promise.all([
          Submissions.getDefsByFormAndLogicalId(form.id, params.rootId, draft, queryOptions),
          Submissions.getByIds(params.projectId, params.formId, params.rootId, draft)
            .then(getOrNotFound)
        ]))
        .then(([ versions ]) => versions)));

    const single = (ext, out) => service.get(`${base}/:rootId/versions/:instanceId${ext}`, endpoint(({ Forms, Submissions }, { params, auth, queryOptions }) =>
      getForm(params, Forms)
        .then(auth.canOrReject('submission.read'))
        .then((form) => Promise.all([
          Submissions.getByIds(params.projectId, params.formId, params.rootId, draft)
            .then(getOrNotFound),
          Submissions.getAnyDefByFormAndInstanceId(form.id, params.instanceId, draft, queryOptions)
            .then(getOrNotFound)
        ]).then(([ , def ]) => out(def)))));
    single('.xml', (def) => xml(def.xml));
    single('', identity);

    service.get(`${base}/:rootId/versions/:instanceId/attachments`, endpoint(({ Forms, Submissions, SubmissionAttachments }, { params, auth }) =>
      getForm(params, Forms)
        .then(auth.canOrReject('submission.read'))
        .then((form) => Promise.all([
          SubmissionAttachments.getForFormAndInstanceId(form.id, params.instanceId, draft),
          Submissions.verifyVersion(form.id, params.rootId, params.instanceId, draft)
        ]))
        .then(([ atts ]) => atts)));

    service.get(`${base}/:rootId/versions/:instanceId/attachments/:name`, endpoint(({ s3, Forms, Submissions, SubmissionAttachments }, { params, auth }) =>
      getForm(params, Forms)
        .then(auth.canOrReject('submission.read'))
        .then((form) => Promise.all([
          SubmissionAttachments.getBlobByFormAndInstanceId(form.id, params.instanceId, params.name, draft)
            .then(getOrNotFound),
          Submissions.verifyVersion(form.id, params.rootId, params.instanceId, draft)
        ]))
        .then(([ blob ]) => blobResponse(s3, params.name, blob))));

    ////////////////////////////////////////////////////////////////////////////////
    // Diffs between all versions of a submission

    service.get(`${base}/:rootId/diffs`, endpoint(({ Forms, Submissions }, { params, auth }) =>
      getForm(params, Forms)
        .then(auth.canOrReject('submission.read'))
        .then((form) => Promise.all([
          Forms.getStructuralFields(form.def.id),
          Submissions.getDefsByFormAndLogicalId(form.id, params.rootId, draft),
          Submissions.getByIds(params.projectId, params.formId, params.rootId, draft)
            .then(getOrNotFound)
        ]))
        .then(([ structurals, versions ]) => diffSubmissions(structurals, versions))));
  };

  dataOutputs('/projects/:projectId/forms/:formId/submissions', false, (params, Forms) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.formId)
      .then(getOrNotFound));

  dataOutputs('/projects/:projectId/forms/:formId/draft/submissions', true, (params, Forms) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.formId, undefined, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef));
};

