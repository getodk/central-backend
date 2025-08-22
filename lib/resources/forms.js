// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const path = require('path');
const { identity } = require('ramda');
const { Blob, Form } = require('../model/frames');
const { ensureDef } = require('../model/frame');
const { QueryOptions } = require('../util/db');
const { isTrue, xml, contentDisposition, withEtag } = require('../util/http');
const { blobResponse, defaultMimetypeFor } = require('../util/blob');
const Problem = require('../util/problem');
const { sanitizeFieldsForOdata, setVersion } = require('../data/schema');
const { getOrNotFound, reject, resolve, rejectIf } = require('../util/promise');
const { success } = require('../util/http');
const { formList, formManifest } = require('../formats/openrosa');
const { noargs, isPresent, isBlank, attachmentToDatasetName } = require('../util/util');
const { streamEntityCsvAttachment } = require('../data/entity');

// excel-related util funcs/data used below:
const isExcel = (contentType) => (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') || (contentType === 'application/vnd.ms-excel');
const excelMimeTypes = {
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const canReadForm = (auth, form) => {
  if (form.def?.publishedAt == null) {
    return auth.canOrReject('form.update', form);
  } else if (form.state === 'closed') {
    return auth.canOrReject('form.read', form);
  } else {
    return auth.canOrReject(['open_form.read', 'form.read'], form);
  }
};
// Returns QueryOptions to use to limit entity access according to ownerOnly.
const getOwnerOnlyOptions = async (auth, project) => ((await auth.can('entity.list', project))
  ? QueryOptions.none
  : QueryOptions.none.withCondition({ 'entities.creatorId': auth.actor.get().id }));

const streamAttachment = async (container, attachment, ownerOnlyOptions, response) => {
  const { s3, Blobs, Datasets, Entities } = container;

  if (attachment.blobId == null && attachment.datasetId == null) {
    return reject(Problem.user.notFound());
  } else if (attachment.blobId != null) {
    const blob = await Blobs.getById(attachment.blobId).then(getOrNotFound);
    return blobResponse(s3, attachment.name, blob);
  } else {
    const properties = await Datasets.getProperties(attachment.datasetId);
    return withEtag(attachment.openRosaHash, async () => {
      const options = attachment.ownerOnly ? ownerOnlyOptions : QueryOptions.none;
      const entities = await Entities.streamForExport(attachment.datasetId, options);
      response.append('Content-Disposition', contentDisposition(`${attachment.name}`));
      response.append('Content-Type', 'text/csv');
      return streamEntityCsvAttachment(entities, properties);
    });
  }
};

module.exports = (service, endpoint, anonymousEndpoint) => {
  // This forms list can also be used to get a list of just the soft-deleted forms by adding ?deleted=true
  // TODO: paging.
  service.get('/projects/:projectId/forms', endpoint(({ Forms, Projects }, { auth, params, query, queryOptions }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject(['form.list', 'open_form.list'], project))
      .then((project) => Forms.getByProjectId(auth, project.id, Form.AnyVersion, Form.WithoutXml, queryOptions, isTrue(query.deleted)))));

  // non-REST openrosa endpoint for project-specialized formlist.
  service.get('/projects/:projectId/formList', endpoint.openRosa(({ Forms, Projects, env }, { auth, params, originalUrl, queryOptions }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
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
      .then(rejectIf((partial) => (/\.(xlsx?|xml)$/.test(partial.xmlFormId)),
        (partial) => Problem.user.unexpectedValue({
          field: 'formId',
          value: partial.xmlFormId,
          reason: 'The Form ID cannot end in .xls, .xlsx, or .xml. Please either specify an allowed ID in the form itself, or rename the file (eg change form.xls.xls to form.xls).'
        })))
      // if we don't have managed encryption, or the form carries its own key,
      // we can use the form xml as-is. otherwise we must inject things
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
        .then((partial) => Forms.createNew(partial, project))
        .then((newForm) => (isTrue(query.publish)
          ? Forms.publish(newForm, true)
          : newForm)))));

  // can POST empty body to copy the current def to draft.
  service.post('/projects/:projectId/forms/:xmlFormId/draft', endpoint(({ Forms, Keys, Projects, Submissions }, { params, auth }, request) =>
    Promise.all([
      Projects.getById(params.projectId).then(getOrNotFound),
      Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion).then(getOrNotFound)
    ])
      .then(([ project, form ]) => auth.canOrReject('form.update', form)
        .then(() => ((request.is('*/*') === false) // false only if no request body.
          ? Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion, Form.IncludeXml)
            .then(getOrNotFound)
            .then((published) => ((published.xml == null)
              ? reject(Problem.user.missingParameter({ field: 'xml' }))
              : getPartial(Forms, published.xml, project, Keys)
                // copy forward xlsx reference only if no file is uploaded
                .then((partial) => partial.withAux('xls', { xlsBlobId: published.def.xlsBlobId }))))
          : getPartial(Forms, request, project, Keys)))
        .then((partial) => Promise.all([
          Forms.createVersion(partial, form, false),
          Submissions.deleteDraftSubmissions(form.id)
        ]))
        .then(() => Forms.clearUnneededDrafts(form))) // remove drafts made obsolete by new draft
      .then(success)));

  service.post('/projects/:projectId/forms/:xmlFormId/draft/publish', endpoint(({ Forms, Submissions }, { params, auth, query }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion, Form.IncludeXml)
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
          // copy forward xlsx reference since no real change was made
          .then((partial) => partial.withAux('xls', { xlsBlobId: form.def.xlsBlobId }))
          .then((partial) => Forms.createVersion(partial, form, false, true))
          .then(() => Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion))
          .then(getOrNotFound)
        : resolve(form)))
      .then(((form) => Promise.all([ Forms.publish(form), Submissions.deleteDraftSubmissions(form.id) ])))
      .then(success)));

  // Entity/Dataset-specific endpoint that is used to show how publishing
  // a form will change any datasets mentioned in the form.
  // Even though there are dataset-related permissions, we will use a combination of dataset access and
  // form verbs for authorization.
  // We are not considering a separate 'dataset.update' verb right now because it seems weird to mix the
  // ability/inability to alter a dataset with the ability to modify forms -- they should just be the same.
  service.get('/projects/:projectId/forms/:xmlFormId/draft/dataset-diff', endpoint(({ Forms, Datasets, Projects }, { params, auth }) =>
    Promise.all([
      Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion),
      Projects.getById(params.projectId)
    ])
      .then(([form, project]) =>
        Promise.all([
          getOrNotFound(form),
          getOrNotFound(project),
        ]))
      .then(([form, project]) =>
        Promise.all([
          canReadForm(auth, form),
          auth.canOrReject('dataset.list', project)
        ]))
      .then(([form]) => ensureDef(form))
      .then((form) => (form.aux.def.keyId
        ? [] // return empty array if encryption is enabled
        : Datasets.getDiff(params.projectId, params.xmlFormId, true)))));

  service.get('/projects/:projectId/forms/:xmlFormId/dataset-diff', endpoint(({ Forms, Datasets, Projects }, { params, auth }) =>
    Promise.all([
      Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion),
      Projects.getById(params.projectId)
    ])
      .then(([form, project]) =>
        Promise.all([
          getOrNotFound(form),
          getOrNotFound(project),
        ]))
      .then(([form, project]) =>
        Promise.all([
          canReadForm(auth, form),
          auth.canOrReject('dataset.list', project)
        ]))
      .then(([form]) => ensureDef(form))
      .then((form) => (form.aux.def.keyId
        ? [] // return empty array if encryption is enabled
        : Datasets.getDiff(params.projectId, params.xmlFormId, false)))));

  service.patch('/projects/:projectId/forms/:xmlFormId/draft/attachments/:name', endpoint(({ Datasets, FormAttachments, Forms }, { auth, params, body }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => Promise.all([
        Datasets.get(params.projectId, attachmentToDatasetName(params.name), true)
          .then(getOrNotFound)
          .then((dataset) => auth.canOrReject('entity.list', dataset)),
        FormAttachments.getByFormDefIdAndName(form.draftDefId, params.name).then(getOrNotFound)
      ])
        .then(([dataset, attachment]) => (attachment.type !== 'file' && body.dataset ?
          Problem.user.datasetLinkNotAllowed() :
          // Unlike the POST endpoint for uploading a file, we do not need to
          // use FormAttachments.getByFormDefIdAndName() to re-fetch the
          // attachment after updating it. Compared to the return value from
          // FormAttachments.update(), getByFormDefIdAndName() just joins in the
          // blob hash. But we're setting blobId to `null` here, so we know
          // already that there is no blob hash.
          FormAttachments.update(form, attachment, null, body.dataset ? dataset.id : null))))));


  service.delete('/projects/:projectId/forms/:xmlFormId/draft', endpoint(({ Audits, Forms, Submissions }, { params, auth }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then(rejectIf(((form) => form.currentDefId == null), noargs(Problem.user.noPublishedVersion)))
      .then(rejectIf(((form) => form.draftDefId == null), noargs(Problem.user.notFound)))
      .then((form) => Promise.all([
        Forms.clearDraft(form).then(() => Forms.clearUnneededDrafts(form)),
        Submissions.deleteDraftSubmissions(form.id),
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
        .then((form) => canReadForm(auth, form))
        .then((form) => xml(form.xml))));

    // we could move this up a scope to save a couple instantiations, but really it's
    // not that expensive and it reads more easily here.
    const getXls = (extension) => endpoint(({ s3, Blobs, Forms }, { params, auth }) =>
      getInstance(Forms, params)
        .then((form) => canReadForm(auth, form))
        .then((form) => ((form.def.xlsBlobId == null)
          ? reject(Problem.user.notFound())
          : Blobs.getById(form.def.xlsBlobId)
            .then(getOrNotFound)
            .then(rejectIf(((blob) => blob.contentType !== excelMimeTypes[extension]), noargs(Problem.user.notFound)))
            .then((blob) => blobResponse(s3, `${form.xmlFormId}.${extension}`, blob)))));
    service.get(`${base}.xls`, getXls('xls'));
    service.get(`${base}.xlsx`, getXls('xlsx'));

    service.get(`${base}`, endpoint(({ Forms }, { auth, params, queryOptions }) =>
      getInstance(Forms, params, false, queryOptions)
        .then((form) => canReadForm(auth, form))));

    // returns form fields, optionally sanitizing names to match odata.
    service.get(`${base}/fields`, endpoint(({ Forms }, { params, query, auth }) =>
      getInstance(Forms, params)
        .then((form) => canReadForm(auth, form))
        .then((form) => Forms.getFields(form.def.id)
          .then(isTrue(query.odata) ? sanitizeFieldsForOdata : identity))));

    // non-REST openrosa endpoint for formlist manifest document.
    service.get(`${base}/manifest`, endpoint.openRosa(async ({ Projects, FormAttachments, Forms, env }, { auth, params, originalUrl }) => {
      const form = await getInstance(Forms, params);
      await canReadForm(auth, form);
      const project = await Projects.getById(form.projectId).then(getOrNotFound);
      const options = await getOwnerOnlyOptions(auth, project);
      const attachments = await FormAttachments.getAllByFormDefIdForOpenRosa(form.def.id, options);
      return formManifest({
        attachments,
        basePath: path.resolve(originalUrl, '..'),
        domain: env.domain,
        projectPath: originalUrl.match(/^\/v1\/(.*\/)?projects\/\d+/)[0]
      });
    }));

    ////////////////////////////////////////
    // READ-ONLY ATTACHMENT ENDPOINTS
    // form attachments endpoints. note that due to the business semantics, it is
    // not possible for the client to create or destroy attachments, or modify
    // their metadata; they may only update their binary contents.
    service.get(`${base}/attachments`, endpoint(({ FormAttachments, Forms }, { params, auth }) =>
      getInstance(Forms, params)
        .then((form) => canReadForm(auth, form))
        .then((form) => FormAttachments.getAllByFormDefId(form.def.id))));

    service.get(`${base}/attachments/:name`, endpoint(async (container, { params, auth }, request, response) => {
      const { Projects, FormAttachments, Forms } = container;
      const form = await getInstance(Forms, params);
      await canReadForm(auth, form);
      const project = await Projects.getById(form.projectId).then(getOrNotFound);
      const options = await getOwnerOnlyOptions(auth, project);
      const attachment = await FormAttachments.getByFormDefIdAndNameForOpenRosa(form.def.id, params.name, options)
        .then(getOrNotFound);
      return streamAttachment(container, attachment, options, response);
    }));
  };

  formResource('/projects/:projectId/forms/:xmlFormId', (Forms, params, withXml = false, options = QueryOptions.none) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.AnyVersion, Form.withXml(withXml), options)
      .then(getOrNotFound));
  formResource('/projects/:projectId/forms/:xmlFormId/versions/:version', (Forms, params, withXml = false, options = QueryOptions.none) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, params.version, Form.withXml(withXml), options)
      .then(getOrNotFound)
      .then(ensureDef));

  formResource('/projects/:projectId/forms/:xmlFormId/draft', (Forms, params, withXml = false, options = QueryOptions.none) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion, Form.withXml(withXml), options)
      .then(getOrNotFound)
      .then(ensureDef));

  service.get('/form-links/:enketoId/form', endpoint(({ Forms }, { params, auth }) =>
    Forms.getByEnketoId(params.enketoId, Form.WithoutXml, QueryOptions.none)
      .then(getOrNotFound)
      .then((form) => canReadForm(auth, form))));

  ////////////////////////////////////////
  // PRIMARY-FORM SPECIFIC ENDPOINTS

  service.patch('/projects/:projectId/forms/:xmlFormId', endpoint(({ Forms }, { auth, params, body }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => Forms.update(form, Form.fromApi(body)))
      // TODO: sucks to have to re-request but this shouldn't be a perf-critical path.
      .then(() => Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.AnyVersion))
      .then(getOrNotFound)));

  service.delete('/projects/:projectId/forms/:xmlFormId', endpoint(({ Forms }, { auth, params }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.delete', form))
      .then(Forms.del)
      .then(success)));


  ////////////////////////////////////////
  // VERSIONS LISTING

  service.get('/projects/:projectId/forms/:xmlFormId/versions', endpoint(({ Forms }, { auth, params, queryOptions }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef)
      .then(getOrNotFound)
      .then((form) => canReadForm(auth, form))
      .then((form) => Forms.getVersions(form.id, queryOptions))));


  ////////////////////////////////////////
  // RESTORE / UNDELETE

  // Instead of the xmlFormId, this endpoint uses the numeric form id in the database
  service.post('/projects/:projectId/forms/:xmlFormId/restore', endpoint(({ Forms }, { auth, params }) =>
    Forms.getByProjectAndNumericId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.ExcludeXml, QueryOptions.none, true)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.restore', form))
      .then(Forms.restore)
      .then(success)));


  ////////////////////////////////////////
  // DRAFT ATTACHMENT R/W ENDPOINTS

  service.post('/projects/:projectId/forms/:xmlFormId/draft/attachments/:name', endpoint(({ Blobs, FormAttachments, Forms }, { auth, headers, params }, request) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => Promise.all([
        Blob.fromStream(request, headers['content-type'] || defaultMimetypeFor(params.name)).then((blob) => Blobs.ensure(blob)),
        FormAttachments.getByFormDefIdAndName(form.draftDefId, params.name).then(getOrNotFound)
      ])
        .then(([ blobId, attachment ]) => FormAttachments.update(form, attachment, blobId, null))
        // Use FormAttachments.getByFormDefIdAndName() to re-fetch the form
        // attachment in order to join in the blob hash.
        .then(() => FormAttachments.getByFormDefIdAndName(form.draftDefId, params.name))
        .then(getOrNotFound))));

  service.delete('/projects/:projectId/forms/:xmlFormId/draft/attachments/:name', endpoint(({ FormAttachments, Forms }, { params, auth }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => FormAttachments.getByFormDefIdAndName(form.draftDefId, params.name)
        .then(getOrNotFound)
        .then(rejectIf(((attachment) => attachment.blobId == null && attachment.datasetId == null), noargs(Problem.user.notFound)))
        .then((attachment) => FormAttachments.update(form, attachment, null, null))
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

  service.get('/test/:key/projects/:projectId/forms/:xmlFormId/draft/formList', anonymousEndpoint.openRosa(({ Forms, FormAttachments, env }, { params, originalUrl }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion)
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

  service.get('/test/:key/projects/:projectId/forms/:xmlFormId/draft/manifest', anonymousEndpoint.openRosa(({ FormAttachments, Forms, env }, { params, originalUrl }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => FormAttachments.getAllByFormDefIdForOpenRosa(form.def.id)
        .then((attachments) =>
          formManifest({ attachments, basePath: path.resolve(originalUrl, '..'), domain: env.domain })))));

  service.get('/test/:key/projects/:projectId/forms/:xmlFormId/draft.xml', anonymousEndpoint(({ Forms }, { params }) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion, Form.IncludeXml)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => xml(form.xml))));

  service.get('/test/:key/projects/:projectId/forms/:xmlFormId/draft/attachments/:name', anonymousEndpoint((container, { params }, request, response) => {
    const { FormAttachments, Forms } = container;
    return Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then(checkFormToken(params.key))
      .then((form) => FormAttachments.getByFormDefIdAndName(form.def.id, params.name)
        .then(getOrNotFound)
        .then(attachment => streamAttachment(container, attachment, QueryOptions.none, response)));
  }));

};

