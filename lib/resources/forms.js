// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const path = require('path');
const { identity, always } = require('ramda');
const sanitize = require('sanitize-filename');
const { QueryOptions } = require('../util/db');
const { isTrue, xml } = require('../util/http');
const Problem = require('../util/problem');
const { sanitizeFieldsForOdata, setVersion } = require('../data/schema');
const { getOrNotFound, reject, resolve, rejectIf } = require('../util/promise');
const { success } = require('../util/http');
const { formList, formManifest } = require('../outbound/openrosa');
const { isPresent, isBlank } = require('../util/util');


// excel-related util funcs/data used below:
const isExcel = (contentType) => (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') || (contentType === 'application/vnd.ms-excel');
const excelMimeTypes = {
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// util func to ensure the form we fetched successfully joined to the intended def.
// TODO: copied to resources/submissions
const ensureDef = rejectIf(((form) => form.def.id == null), Problem.user.notFound);


module.exports = (service, endpoint) => {
  // TODO: paging.
  service.get('/projects/:projectId/forms', endpoint(({ Project }, { auth, params, queryOptions }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.list', project)
        .then(() => project.getAllForms(queryOptions)))));

  // non-REST openrosa endpoint for project-specialized formlist.
  service.get('/projects/:projectId/formList', endpoint.openRosa(({ Project, env }, { auth, params, originalUrl }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => project.getFormsByAuthForOpenRosa(auth))
      .then((forms) => formList({ forms, basePath: path.resolve(originalUrl, '..'), domain: env.domain }))));

  ////////////////////////////////////////////////////////////////////////////////
  // FORM CREATION, DRAFT CREATION / PUBLISH / DELETE

  // used by both POST /forms and POST /forms/:id/draft below; pulls in an xml or
  // xls file as appropriate, tacks on managed encryption if needed, and folds in
  // the projectId.
  const getPartial = (input, project, FormPartial, Key) =>
    /* eslint-disable indent */
    (
      // input is a plain xml string:
      (typeof input === 'string') ? FormPartial.fromXml(input) :
      // input is a request object; check for excel and maybe do that:
      (isExcel(input.headers['content-type']) ? FormPartial.fromXls(input, input.headers['content-type'],
        input.headers['x-xlsform-formid-fallback'], isTrue(input.query.ignoreWarnings)) :
      // input is a rjquest object but it's not excel; read body as xml:
      FormPartial.fromXml(input.body))
    )
    /* eslint-enable indent */
      // if we don't have managed encryption, or the form carries its own key,
      // we can use the form xml as-is. otherwise we must inject things.
      .then((partial) => (((project.keyId == null) || partial.key.isDefined())
        ? partial
        : Key.getById(project.keyId)
          .then(getOrNotFound) // TODO: better error here
          .then((key) => partial.withManagedKey(key))))
      .then((partial) => partial.with({ projectId: project.id }));

  // optionally takes ?publish=true to skip the draft stage.
  service.post('/projects/:projectId/forms', endpoint(({ Audit, FormPartial, Key, Project }, { params, auth, query }, request) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.create', project))
      .then((project) => getPartial(request, project, FormPartial, Key))
      .then((partial) => partial.createNew(isTrue(query.publish)))
      .then((form) => Audit.log(auth.actor(), 'form.create', form)
        .then(always(form)))));

  // can POST empty body to copy the current def to draft.
  service.post('/projects/:projectId/forms/:id/draft', endpoint(({ Audit, Form, FormPartial, Key, Project }, { params, auth }, request) =>
    Promise.all([
      Project.getById(params.projectId).then(getOrNotFound),
      Form.getByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion()).then(getOrNotFound)
    ])
      .then(([ project, form ]) => auth.canOrReject('form.update', form)
        .then(() => ((request.is('*/*') === false) // false only if no request body.
          ? Form.getWithXmlByProjectAndXmlFormId(params.projectId, params.id)
            .then(getOrNotFound)
            .then((published) => ((published.def.xml == null)
              ? reject(Problem.user.missingParameter({ field: 'xml' }))
              : getPartial(published.def.xml, project, FormPartial, Key)))
          : getPartial(request, project, FormPartial, Key)))
        .then((partial) => Promise.all([
          partial.createVersion(form, false),
          form.clearDraftSubmissions()
        ]))
        .then(([ savedDef ]) => Audit.log(auth.actor(), 'form.update.draft.set', form, { newDraftDefId: savedDef.id })))
      .then(success)));

  service.post('/projects/:projectId/forms/:id/draft/publish', endpoint(({ Audit, Form, FormPartial }, { params, auth, query }) =>
    Form.getWithXmlByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form)
        .then(ensureDef)
        .then(() => (isPresent(query.version)
          // we've been asked to change the form def version before publish.
          // we will do so by getting and patching the xml, and creating a new draft
          // def before proceeding. if anything fails, the whole transaction will bail.
          //
          // we do /not/ bother setting managed encryption here, because it will have
          // already been set on form intake.
          ? setVersion(form.def.xml, query.version)
            .then(FormPartial.fromXml)
            .then((partial) => partial.createVersion(form, false))
            .then((savedDef) => Audit.log(auth.actor(), 'form.update.draft.set', form,
              { newDraftDefId: savedDef.id, oldDraftDefId: form.draftDefId, automated: true })
              .then(() => form.with({ draftDefId: savedDef.id, def: savedDef })))
          : form)))
      .then(((form) => Promise.all([
        form.publish(),
        form.clearDraftSubmissions(),
        Audit.log(auth.actor(), 'form.update.publish', form, { oldDefId: form.currentDefId, newDefId: form.draftDefId })
      ])))
      .then(success)));

  service.delete('/projects/:projectId/forms/:id/draft', endpoint(({ Audit, Form }, { params, auth }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then(rejectIf(
        (form) => (form.draftDefId == null),
        Problem.user.notFound
      ))
      .then((form) => Promise.all([
        // TODO: for now we just cast away the draft to nothing. eventually probably sweep+delete.
        form.with({ draftDefId: null }).update(),
        form.clearDraftSubmissions(),
        Audit.log(auth.actor(), 'form.update.draft.delete', form, { oldDraftDefId: form.draftDefId })
      ]))
      .then(success)));


  ////////////////////////////////////////////////////////////////////////////////
  // GENERIC SINGLE FORM RESOURCE
  // resource generator to create read-only routes for primary/draft/archived form
  // version endpoints:

  const formResource = (base, getInstance) => {
    // get just the XML of the form; used for downloading forms from collect.
    service.get(`${base}.xml`, endpoint(({ Form }, { params, auth }) =>
      getInstance(Form, params, true)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => xml(form.def.xml))));

    // we could move this up a scope to save a couple instantiations, but really it's
    // not that expensive and it reads more easily here.
    const getXls = (extension) => endpoint(({ Blob, Form }, { params, auth }, _, response) =>
      getInstance(Form, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => ((form.def.xlsBlobId == null)
          ? reject(Problem.user.notFound())
          : Blob.getById(form.def.xlsBlobId)
            .then(getOrNotFound)
            .then((blob) => {
              if (blob.contentType !== excelMimeTypes[extension])
                return reject(Problem.user.notFound());

              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${sanitize(form.xmlFormId)}.${extension}"`);
              return blob.content;
            }))));
    service.get(`${base}.xls`, getXls('xls'));
    service.get(`${base}.xlsx`, getXls('xlsx'));

    service.get(`${base}`, endpoint(({ Form }, { auth, params, queryOptions }) =>
      getInstance(Form, params, false, queryOptions)
        .then((form) => auth.canOrReject('form.read', form))));

    // returns form fields, optionally sanitizing names to match odata.
    service.get(`${base}/fields`, endpoint(({ Form }, { params, query, auth }) =>
      getInstance(Form, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => form.def.getFields()
          .then(isTrue(query.odata) ? sanitizeFieldsForOdata : identity))));

    // non-REST openrosa endpoint for formlist manifest document.
    service.get(`${base}/manifest`, endpoint.openRosa(({ FormAttachment, Form, env }, { auth, params, originalUrl }) =>
      getInstance(Form, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => FormAttachment.getAllByFormDefIdForOpenRosa(form.def.id)
          .then((attachments) =>
            formManifest({ attachments, basePath: path.resolve(originalUrl, '..'), domain: env.domain })))));

    ////////////////////////////////////////
    // READ-ONLY ATTACHMENT ENDPOINTS
    // form attachments endpoints. note that due to the business semantics, it is
    // not possible for the client to create or destroy attachments, or modify
    // their metadata; they may only update their binary contents.
    service.get(`${base}/attachments`, endpoint(({ FormAttachment, Form }, { params, auth }) =>
      getInstance(Form, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => FormAttachment.getAllByFormDefId(form.def.id))));

    service.get(`${base}/attachments/:name`, endpoint(({ Blob, FormAttachment, Form }, { params, auth }, _, response) =>
      getInstance(Form, params)
        .then((form) => auth.canOrReject('form.read', form))
        .then((form) => FormAttachment.getByFormDefIdAndName(form.def.id, params.name)
          .then(getOrNotFound)
          .then((attachment) => ((attachment.blobId == null)
            ? reject(Problem.user.notFound())
            : Blob.getById(attachment.blobId)
              .then(getOrNotFound)
              .then((blob) => {
                response.set('Content-Type', blob.contentType);
                response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
                return blob.content;
              }))))));
  };

  // the linter literally won't let me break this apart..
  formResource('/projects/:projectId/forms/:id', (Form, params, withXml = false, options = QueryOptions.none) =>
    ((withXml === true) ? Form.getWithXmlByProjectAndXmlFormId : Form.getByProjectAndXmlFormId)(params.projectId, params.id, options)
      .then(getOrNotFound));

  formResource('/projects/:projectId/forms/:id/versions/:version', (Form, params, withXml = false, options = QueryOptions.none) =>
    ((withXml === true) ? Form.getWithXmlByProjectAndXmlFormId : Form.getByProjectAndXmlFormId)(params.projectId, params.id, options, params.version)
      .then(getOrNotFound)
      .then(ensureDef));

  formResource('/projects/:projectId/forms/:id/draft', (Form, params, withXml = false, options = QueryOptions.none) =>
    ((withXml === true) ? Form.getWithXmlByProjectAndXmlFormId : Form.getByProjectAndXmlFormId)(params.projectId, params.id, options, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef));


  ////////////////////////////////////////
  // PRIMARY-FORM SPECIFIC ENDPOINTS

  service.patch('/projects/:projectId/forms/:id', endpoint(({ Form, Audit }, { auth, params, body }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => resolve(Form.fromApi(body)) // TODO: lame.
        .then((patchData) => Promise.all([
          form.with(patchData).update()
            // TODO: sucks to have to re-request but this shouldn't be a perf-critical path.
            .then(() => Form.getByProjectAndXmlFormId(params.projectId, params.id))
            .then(getOrNotFound),
          Audit.log(auth.actor(), 'form.update', form, { data: patchData })
        ]))
        .then(([ updated ]) => updated))));

  service.delete('/projects/:projectId/forms/:id', endpoint(({ Form, Audit }, { auth, params }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.delete', form))
      .then((form) => Promise.all([
        form.delete(),
        Audit.log(auth.actor(), 'form.delete', form)
      ]))
      .then(success)));


  ////////////////////////////////////////
  // VERSIONS LISTING

  service.get('/projects/:projectId/forms/:id/versions', endpoint(({ Form }, { auth, params, queryOptions }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.read', form))
      .then((form) => form.getVersions(queryOptions))));


  ////////////////////////////////////////
  // DRAFT ATTACHMENT R/W ENDPOINTS

  service.post('/projects/:projectId/forms/:id/draft/attachments/:name', endpoint(({ Audit, Blob, FormAttachment, Form }, { auth, headers, params }, request) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => Promise.all([
        Blob.fromStream(request, headers['content-type']).then((blob) => blob.ensure()),
        FormAttachment.getByFormDefIdAndName(form.draftDefId, params.name).then(getOrNotFound)
      ])
        .then(([ blob, attachment ]) => Promise.all([
          attachment.with({ blobId: blob.id }).update(),
          Audit.log(auth.actor(), 'form.attachment.update', form, { formDefId: form.draftDefId, name: attachment.name, oldBlobId: attachment.blobId, newBlobId: blob.id })
        ]))
        .then(success))));

  service.delete('/projects/:projectId/forms/:id/draft/attachments/:name', endpoint(({ Audit, FormAttachment, Form }, { params, auth }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => FormAttachment.getByFormDefIdAndName(form.draftDefId, params.name)
        .then(getOrNotFound)
        .then((attachment) => ((attachment.blobId == null)
          ? reject(Problem.user.notFound())
          : Promise.all([
            attachment.with({ blobId: null }).update(),
            // technically not deleting the attachment slot, so log as an update:
            Audit.log(auth.actor(), 'form.attachment.update', form, { formDefId: form.draftDefId, name: attachment.name, oldBlobId: attachment.blobId, newBlobId: null })
          ])))
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
    Problem.user.notFound
  );

  service.get('/test/:key/projects/:projectId/forms/:id/draft/formList', endpoint.openRosa(({ Form, env }, { params, originalUrl }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => formList({
        // TODO: trying to use the existing template generator here is really awkward.
        draft: true, forms: [ form ], basePath: path.resolve(originalUrl, '../../../..'), domain: env.domain
      }))));

  service.get('/test/:key/projects/:projectId/forms/:id/draft/manifest', endpoint.openRosa(({ FormAttachment, Form, env }, { params, originalUrl }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => FormAttachment.getAllByFormDefIdForOpenRosa(form.def.id)
        .then((attachments) =>
          formManifest({ attachments, basePath: path.resolve(originalUrl, '..'), domain: env.domain })))));

  service.get('/test/:key/projects/:projectId/forms/:id/draft.xml', endpoint(({ Form }, { params }) =>
    Form.getWithXmlByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => xml(form.def.xml))));

  service.get('/test/:key/projects/:projectId/forms/:id/draft/attachments/:name', endpoint(({ Blob, FormAttachment, Form }, { params }, _, response) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id, undefined, Form.DraftVersion())
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => FormAttachment.getByFormDefIdAndName(form.def.id, params.name)
        .then(getOrNotFound)
        .then((attachment) => ((attachment.blobId == null)
          ? reject(Problem.user.notFound())
          : Blob.getById(attachment.blobId)
            .then(getOrNotFound)
            .then((blob) => {
              response.set('Content-Type', blob.contentType);
              response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
              return blob.content;
            }))))));
};

