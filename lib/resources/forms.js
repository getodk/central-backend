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
const { flattenSchemaStructures, sanitizeOdataIdentifiers } = require('../data/schema');
const { isTrue, xml } = require('../util/http');
const Problem = require('../util/problem');
const { getOrNotFound, reject, resolve } = require('../util/promise');
const { success } = require('../util/http');
const { formList, formManifest } = require('../outbound/openrosa');

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

  const isExcel = (contentType) => (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') || (contentType === 'application/vnd.ms-excel');
  service.post('/projects/:projectId/forms', endpoint(({ Audit, FormPartial, Key, Project }, { body, params, auth, headers, query }, request) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.create', project)
        .then(() => (isExcel(headers['content-type'])
          ? FormPartial.fromXls(request, headers['content-type'],
            headers['x-xlsform-formid-fallback'], isTrue(query.ignoreWarnings))
          : FormPartial.fromXml(body)))
        // if we don't have managed encryption, or the form carries its own key,
        // we can use the form xml as-is. otherwise we must inject things.
        .then((partial) => (((project.keyId == null) || partial.key.isDefined())
          ? partial
          : Key.getById(project.keyId)
            .then(getOrNotFound) // TODO: better error here
            .then((key) => partial.withManagedKey(key))))
        .then((partial) => partial.with({ projectId: project.id }).createNew()
          .then((form) => Audit.log(auth.actor(), 'form.create', form)
            .then(always(form)))))));

  // get just the XML of the form; used for downloading forms from collect.
  service.get('/projects/:projectId/forms/:id.xml', endpoint(({ Form }, { params, auth }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.read', form))
      .then((form) => xml(form.def.xml))));

  service.get('/projects/:projectId/forms/:id.schema.json', endpoint(({ Form }, { params, query, auth }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.read', form))
      .then((form) => form.def.schema()
        .then(isTrue(query.odata) ? sanitizeOdataIdentifiers : identity)
        .then(isTrue(query.flatten) ? flattenSchemaStructures : identity))));

  const excelMimeTypes = {
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  const getXls = (extension) => endpoint(({ Blob, Form }, { params, auth }, _, response) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
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
  service.get('/projects/:projectId/forms/:id.xls', getXls('xls'));
  service.get('/projects/:projectId/forms/:id.xlsx', getXls('xlsx'));

  service.get('/projects/:projectId/forms/:id', endpoint(({ Form }, { auth, params, queryOptions }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id, queryOptions)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.read', form))));

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

  // non-REST openrosa endpoint for formlist manifest document.
  service.get('/projects/:projectId/forms/:id/manifest', endpoint.openRosa(({ FormAttachment, Form, env }, { auth, params, originalUrl }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.read', form))
      .then((form) => FormAttachment.getAllByFormDefIdForOpenRosa(form.def.id)
        .then((attachments) =>
          formManifest({ attachments, basePath: path.resolve(originalUrl, '..'), domain: env.domain })))));

  // form attachments endpoints. note that due to the business semantics, it is
  // not possible for the client to create or destroy attachments, or modify
  // their metadata; they may only update their binary contents.
  service.get('/projects/:projectId/forms/:id/attachments', endpoint(({ FormAttachment, Form }, { params, auth }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.read', form))
      .then((form) => FormAttachment.getAllByFormDefId(form.def.id))));

  service.get('/projects/:projectId/forms/:id/attachments/:name', endpoint(({ Blob, FormAttachment, Form }, { params, auth }, _, response) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
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

  service.post('/projects/:projectId/forms/:id/attachments/:name', endpoint(({ Audit, Blob, FormAttachment, Form }, { auth, headers, params }, request) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => Promise.all([
        Blob.fromStream(request, headers['content-type']).then((blob) => blob.ensure()),
        FormAttachment.getByFormDefIdAndName(form.def.id, params.name).then(getOrNotFound)
      ])
        .then(([ blob, attachment ]) => Promise.all([
          attachment.with({ blobId: blob.id }).update(),
          Audit.log(auth.actor(), 'form.attachment.update', form, { formDefId: form.def.id, name: attachment.name, oldBlobId: attachment.blobId, newBlobId: blob.id })
        ]))
        .then(success))));

  service.delete('/projects/:projectId/forms/:id/attachments/:name', endpoint(({ Audit, FormAttachment, Form }, { params, auth }) =>
    Form.getByProjectAndXmlFormId(params.projectId, params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('form.update', form))
      .then((form) => FormAttachment.getByFormDefIdAndName(form.def.id, params.name)
        .then(getOrNotFound)
        .then((attachment) => ((attachment.blobId == null)
          ? reject(Problem.user.notFound())
          : Promise.all([
            attachment.with({ blobId: null }).update(),
            // technically not deleting the attachment slot, so log as an update:
            Audit.log(auth.actor(), 'form.attachment.update', form, { formDefId: form.def.id, name: attachment.name, oldBlobId: attachment.blobId, newBlobId: null })
          ])))
        .then(success))));
};

