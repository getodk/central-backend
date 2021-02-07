// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const path = require('path');
const { identity } = require('ramda');
const sanitize = require('sanitize-filename');
const { Blob, Form } = require('../model/frames');
const { QueryOptions } = require('../util/db');
const { isTrue, xml } = require('../util/http');
const Problem = require('../util/problem');
const { sanitizeFieldsForOdata, setVersion } = require('../data/schema');
const { getOrNotFound, reject, resolve, rejectIf } = require('../util/promise');
const { success } = require('../util/http');
const { formList, formManifest } = require('../outbound/openrosa');
const { noargs, isPresent, isBlank } = require('../util/util');


// excel-related util funcs/data used below:
const isExcel = (contentType) => (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') || (contentType === 'application/vnd.ms-excel');
const excelMimeTypes = {
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// util func to ensure the form we fetched successfully joined to the intended def.
// TODO: copied to resources/submissions
const ensureDef = rejectIf(((form) => form.def.id == null), noargs(Problem.user.notFound));


module.exports = (service, endpoint) => {
  // TODO: paging.
  service.get('/projects/:projectId/forms', endpoint(({ Forms, Projects }, { auth, params, queryOptions }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.list', project))
      .then((project) => Forms.getByProjectId(project.id, false, undefined, queryOptions))));

  // non-REST openrosa endpoint for project-specialized formlist.
  service.get('/projects/:projectId/formList', endpoint.openRosa(({ Forms, Projects, env }, { auth, params, originalUrl, queryOptions }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then(rejectIf((() => auth.actor.isEmpty()), noargs(Problem.user.openRosaAuthenticationRequired)))
      .then((project) => Forms.getByAuthForOpenRosa(project.id, auth, queryOptions.allowArgs('formID')))
      .then((forms) => formList({ forms, basePath: path.resolve(originalUrl, '..'), domain: env.domain }))));

  ////////////////////////////////////////////////////////////////////////////////
  // FORM CREATION, DRAFT CREATION / PUBLISH / DELETE

  // used by both POST /forms and POST /forms/:id/draft below; pulls in an xml or
  // xls file as appropriate, tacks on managed encryption if needed, and folds in
  // the projectId.
  const getPartial = (Forms, input, project, Keys) =>
    /* eslint-disable indent */
    (
      // input is a plain xml string:
      (typeof input === 'string') ? Form.fromXml(input) :
      // input is a request object; check for excel and maybe do that:
      (isExcel(input.headers['content-type']) ? Forms.fromXls(input, input.headers['content-type'],
        input.headers['x-xlsform-formid-fallback'], isTrue(input.query.ignoreWarnings)) :
      // input is a rjquest object but it's not excel; read body as xml:
      Form.fromXml(input))
    )
    /* eslint-enable indent */
      // if we don't have managed encryption, or the form carries its own key,
      // we can use the form xml as-is. otherwise we must inject things.
      .then((partial) => (((project.keyId == null) || partial.aux.key.isDefined())
        ? partial
        : Keys.getById(project.keyId)
          .then(getOrNotFound) // TODO: better error here
          .then((key) => partial.withManagedKey(key))))
      .then((partial) => partial.with({ projectId: project.id }));

  // optionally takes ?publish=true to skip the draft stage.
  service.post('/projects/:projectId/forms', endpoint(({ Forms, Keys, Projects }, { params, auth, query }, request) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.create', project))
      .then((project) => getPartial(Forms, request, project, Keys)
        .then((partial) => Forms.createNew(partial, project, isTrue(query.publish))))));

  // can POST empty body to copy the current def to draft.
  service.post('/projects/:projectId/forms/:id/draft', endpoint(({ Forms, Keys, Projects, Submissions }, { params, auth }, request) =>
    Promise.all([
      Projects.getById(params.projectId).then(getOrNotFound),
      Forms.getByProjectAndXmlFormId(params.projectId, params.id, false, Form.DraftVersion).then(getOrNotFound)
    ])
      .then(([ project, form ]) => auth.canOrReject('form.update', form)
        .then(() => ((request.is('*/*') === false) // false only if no request body.
          ? Forms.getByProjectAndXmlFormId(params.projectId, params.id, true)
            .then(getOrNotFound)
            .then((published) => ((published.xml == null)
              ? reject(Problem.user.missingParameter({ field: 'xml' }))
              : getPartial(Forms, published.xml, project, Keys)))
          : getPartial(Forms, request, project, Keys)))
        .then((partial) => Promise.all([
          Forms.createVersion(partial, form, false),
          Submissions.clearDraftSubmissions(form.id)
        ])))
      .then(success)));

  service.post('/projects/:projectId/forms/:id/draft/publish', endpoint(({ Forms, Submissions }, { params, auth, query }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, true, Form.DraftVersion)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then(ensureDef)
      .then((form) => (isPresent(query.version)
        // we've been asked to change the form def version before publish.
        // we will do so by getting and patching the xml, and creating a new draft
        // def before proceeding. if anything fails, the whole transaction will bail.
        //
        // we do /not/ bother setting managed encryption here, because it will have
        // already been set on form intake.
        ? setVersion(form.xml, query.version)
          .then(Form.fromXml)
          .then((partial) => Forms.createVersion(partial, form, false))
          .then(() => Forms.getByProjectAndXmlFormId(params.projectId, params.id, false, Form.DraftVersion))
          .then(getOrNotFound)
        : resolve(form)))
      .then(((form) => Promise.all([ Forms.publish(form), Submissions.clearDraftSubmissions(form.id) ])))
      .then(success)));

  service.delete('/projects/:projectId/forms/:id/draft', endpoint(({ Audits, Forms, Submissions }, { params, auth }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then(rejectIf(((form) => form.currentDefId == null), noargs(Problem.user.noPublishedVersion)))
      .then(rejectIf(((form) => form.draftDefId == null), noargs(Problem.user.notFound)))
      .then((form) => Promise.all([
        // TODO: for now we just cast away the draft to nothing. eventually probably sweep+delete.
        Forms.clearDraft(form),
        Submissions.clearDraftSubmissions(form.id),
        Audits.log(auth.actor, 'form.update.draft.delete', form, { oldDraftDefId: form.draftDefId })
      ]))
      .then(success)));


  ////////////////////////////////////////////////////////////////////////////////
  // GENERIC SINGLE FORM RESOURCE
  // resource generator to create read-only routes for primary/draft/archived form
  // version endpoints:

  const formResource = (base, getInstance) => {
    // get just the XML of the form; used for downloading forms from collect.
    service.get(`${base}.xml`, endpoint(({ Forms }, { params, auth }) =>
      getInstance(Forms, params, true)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => xml(form.xml))));

    // we could move this up a scope to save a couple instantiations, but really it's
    // not that expensive and it reads more easily here.
    const getXls = (extension) => endpoint(({ Blobs, Forms }, { params, auth }, _, response) =>
      getInstance(Forms, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => ((form.def.xlsBlobId == null)
          ? reject(Problem.user.notFound())
          : Blobs.getById(form.def.xlsBlobId)
            .then(getOrNotFound)
            .then(rejectIf(((blob) => blob.contentType !== excelMimeTypes[extension]), noargs(Problem.user.notFound)))
            .then((blob) => {
              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${sanitize(form.xmlFormId)}.${extension}"`);
              return blob.content;
            }))));
    service.get(`${base}.xls`, getXls('xls'));
    service.get(`${base}.xlsx`, getXls('xlsx'));

    service.get(`${base}`, endpoint(({ Forms }, { auth, params, queryOptions }) =>
      getInstance(Forms, params, false, queryOptions)
        .then((form) => auth.canOrReject('form.read', form))));

    // returns form fields, optionally sanitizing names to match odata.
    service.get(`${base}/fields`, endpoint(({ Forms }, { params, query, auth }) =>
      getInstance(Forms, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => Forms.getFields(form.def.id)
          .then(isTrue(query.odata) ? sanitizeFieldsForOdata : identity))));

    // non-REST openrosa endpoint for formlist manifest document.
    service.get(`${base}/manifest`, endpoint.openRosa(({ FormAttachments, Forms, env }, { auth, params, originalUrl }) =>
      getInstance(Forms, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => FormAttachments.getAllByFormDefIdForOpenRosa(form.def.id)
          .then((attachments) =>
            formManifest({ attachments, basePath: path.resolve(originalUrl, '..'), domain: env.domain })))));

    ////////////////////////////////////////
    // READ-ONLY ATTACHMENT ENDPOINTS
    // form attachments endpoints. note that due to the business semantics, it is
    // not possible for the client to create or destroy attachments, or modify
    // their metadata; they may only update their binary contents.
    service.get(`${base}/attachments`, endpoint(({ FormAttachments, Forms }, { params, auth }) =>
      getInstance(Forms, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => FormAttachments.getAllByFormDefId(form.def.id))));

    service.get(`${base}/attachments/:name`, endpoint(({ Blobs, FormAttachments, Forms }, { params, auth }, _, response) =>
      getInstance(Forms, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => FormAttachments.getByFormDefIdAndName(form.def.id, params.name)
          .then(getOrNotFound)
          .then((attachment) => ((attachment.blobId == null)
            ? reject(Problem.user.notFound())
            : Blobs.getById(attachment.blobId)
              .then(getOrNotFound)
              .then((blob) => {
                response.set('Content-Type', blob.contentType);
                response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
                return blob.content;
              }))))));
  };

  // the linter literally won't let me break this apart..
  formResource('/projects/:projectId/forms/:id', (Forms, params, withXml = false, options = QueryOptions.none) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, withXml, null, options)
      .then(getOrNotFound));

  formResource('/projects/:projectId/forms/:id/versions/:version', (Forms, params, withXml = false, options = QueryOptions.none) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, withXml, params.version, options)
      .then(getOrNotFound)
      .then(ensureDef));

  formResource('/projects/:projectId/forms/:id/draft', (Forms, params, withXml = false, options = QueryOptions.none) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, withXml, Form.DraftVersion, options)
      .then(getOrNotFound)
      .then(ensureDef));


  ////////////////////////////////////////
  // PRIMARY-FORM SPECIFIC ENDPOINTS

  service.patch('/projects/:projectId/forms/:id', endpoint(({ Forms }, { auth, params, body }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => Forms.update(form, Form.fromApi(body)))
      // TODO: sucks to have to re-request but this shouldn't be a perf-critical path.
      .then(() => Forms.getByProjectAndXmlFormId(params.projectId, params.id))
      .then(getOrNotFound)));

  service.delete('/projects/:projectId/forms/:id', endpoint(({ Forms }, { auth, params }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.delete', form))
      .then(Forms.del)
      .then(success)));


  ////////////////////////////////////////
  // VERSIONS LISTING

  service.get('/projects/:projectId/forms/:id/versions', endpoint(({ Forms }, { auth, params, queryOptions }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.read', form))
      .then((form) => Forms.getVersions(form.id, queryOptions))));


  ////////////////////////////////////////
  // DRAFT ATTACHMENT R/W ENDPOINTS

  service.post('/projects/:projectId/forms/:id/draft/attachments/:name', endpoint(({ Blobs, FormAttachments, Forms }, { auth, headers, params }, request) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => Promise.all([
        Blob.fromStream(request, headers['content-type']).then((blob) => Blobs.ensure(blob)),
        FormAttachments.getByFormDefIdAndName(form.draftDefId, params.name).then(getOrNotFound)
      ])
        .then(([ blobId, attachment ]) => FormAttachments.update(form, attachment, blobId))
        .then(success))));

  service.delete('/projects/:projectId/forms/:id/draft/attachments/:name', endpoint(({ FormAttachments, Forms }, { params, auth }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => FormAttachments.getByFormDefIdAndName(form.draftDefId, params.name)
        .then(getOrNotFound)
        .then(rejectIf(((attachment) => attachment.blobId == null), noargs(Problem.user.notFound)))
        .then((attachment) => FormAttachments.update(form, attachment, null))
        .then(success))));


  ////////////////////////////////////////////////////////////////////////////////
  // DRAFT TEST TOKEN ENDPOINTS
  //
  // replicate some key client endpoints over to the /key/:key subresource for draft
  // testing.
  //
  // TODO: most of these are copy-pasted from above.

  // TODO: copied from resources/submissions
  const checkFormToken = (token) => rejectIf(
    ((form) => (form.def.draftToken !== token) || isBlank(form.def.draftToken)),
    noargs(Problem.user.notFound)
  );

  service.get('/test/:key/projects/:projectId/forms/:id/draft/formList', endpoint.openRosa(({ Forms, FormAttachments, env }, { params, originalUrl }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .catch(Problem.translate(Problem.user.notFound, noargs(Problem.user.failedDraftAccess)))
      // TODO: this is really awful. extra request to munge in a value.
      .then((form) => FormAttachments.getAllByFormDefIdForOpenRosa(form.def.id)
        .then((attachments) => attachments.length > 0)
        .then((hasAttachments) =>
          // TODO: trying to use the existing template generator here is really awkward.
          formList({
            draft: true, forms: [ form.withAux('openRosa', { hasAttachments }) ], basePath: path.resolve(originalUrl, '../../../..'), domain: env.domain
          })))));

  service.get('/test/:key/projects/:projectId/forms/:id/draft/manifest', endpoint.openRosa(({ FormAttachments, Forms, env }, { params, originalUrl }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => FormAttachments.getAllByFormDefIdForOpenRosa(form.def.id)
        .then((attachments) =>
          formManifest({ attachments, basePath: path.resolve(originalUrl, '..'), domain: env.domain })))));

  service.get('/test/:key/projects/:projectId/forms/:id/draft.xml', endpoint(({ Forms }, { params }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, true, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => xml(form.xml))));

  service.get('/test/:key/projects/:projectId/forms/:id/draft/attachments/:name', endpoint(({ Blobs, FormAttachments, Forms }, { params }, _, response) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, false, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => FormAttachments.getByFormDefIdAndName(form.def.id, params.name)
        .then(getOrNotFound)
        .then((attachment) => ((attachment.blobId == null)
          ? reject(Problem.user.notFound())
          : Blobs.getById(attachment.blobId)
            .then(getOrNotFound)
            .then((blob) => {
              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
              return blob.content;
            }))))));
};

