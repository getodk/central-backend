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
const { flattenSchemaStructures } = require('../data/schema');
const { isTrue, xml } = require('../util/http');
const { endpoint, openRosaEndpoint } = require('../http/endpoint');
const Problem = require('../util/problem');
const { getOrNotFound, reject } = require('../util/promise');
const { success } = require('../util/http');
const { formList, formManifest } = require('../outbound/openrosa');

module.exports = (service) => {
  // TODO: per-form read auth.
  // TODO: paging.
  // TODO: possibly omit xml.
  service.get('/forms', endpoint(({ Actee, Form }, { auth, queryOptions }) =>
    auth.canOrReject('list', Actee.species('form'))
      .then(() => Form.getAll(queryOptions))));

  // non-REST openrosa endpoint for formlist.
  // TODO: per-form read auth.
  service.get('/formList', openRosaEndpoint(({ Actee, Form, env }, { auth, originalUrl }) =>
    auth.canOrReject('list', Actee.species('form'))
      .then(() => Form.getAllForOpenRosa())
      .then((forms) => formList({ forms, basePath: path.resolve(originalUrl, '..'), domain: env.domain }))));

  service.post('/forms', endpoint(({ Actee, Audit, Form }, { body, auth }) =>
    auth.transacting
      .canOrReject('create', Actee.species('form'))
      .then(() => Form.fromXml(body))
      .then((unsavedForm) => unsavedForm.create()
        .then((form) => form.createExpectedAttachments()
          .then(() => Audit.log(auth.actor(), 'createForm', form)
            .then(() => form))))));

  // get just the XML of the form; used for downloading forms from collect.
  service.get('/forms/:id.xml', endpoint(({ Form }, { params, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => xml(form.xml)))));

  service.get('/forms/:id.schema.json', endpoint(({ Form }, { params, query, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => form.schema()
          .then(isTrue(query.flatten) ? flattenSchemaStructures : identity)))));

  service.get('/forms/:id', endpoint(({ Form }, { auth, params, queryOptions }) =>
    Form.getByXmlFormId(params.id, queryOptions)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => form))));

  service.patch('/forms/:id', endpoint(({ Form }, { auth, params, body }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('update', form)
        .then(() => form.with(Form.fromApi(body)).update())
        .then(success))));

  service.delete('/forms/:id', endpoint(({ Form }, { auth, params }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('delete', form)
        .then(() => form.delete())
        .then(success))));

  // non-REST openrosa endpoint for formlist manifest document.
  service.get('/forms/:id/manifest', openRosaEndpoint(({ Form, FormAttachment, env }, { auth, params, originalUrl }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => FormAttachment.getAllByFormIdForOpenRosa(form.id)
          .then((attachments) =>
            formManifest({ attachments, basePath: path.resolve(originalUrl, '..'), domain: env.domain }))))));

  // form attachments endpoints. note that due to the business semantics, it is
  // not possible for the client to create or destroy attachments, or modify
  // their metadata; they may only update their binary contents.
  service.get('/forms/:id/attachments', endpoint(({ Form, FormAttachment }, { params, auth, queryOptions }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => FormAttachment.getAllByFormId(form.id, queryOptions)))));

  service.get('/forms/:id/attachments/:name', endpoint(({ Blob, Form, FormAttachment }, { params, auth }, response) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => FormAttachment.getByFormAndName(form.id, params.name)
          .then(getOrNotFound)
          .then((attachment) => ((attachment.blobId == null)
            ? reject(Problem.user.notFound())
            : Blob.getById(attachment.blobId)
              .then(getOrNotFound)
              .then((blob) => {
                response.set('Content-Type', blob.contentType);
                response.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
                return blob.content;
              })))))));

  service.post('/forms/:id/attachments/:name', endpoint(({ all, Audit, Blob, Form, FormAttachment }, request) =>
    Form.getByXmlFormId(request.params.id)
      .then(getOrNotFound)
      .then((form) => request.auth.canOrReject('update', form)
        .then(() => all.do([
          Blob.fromStream(request, request.headers['content-type']).then((blob) => blob.create()),
          FormAttachment.getByFormAndName(form.id, request.params.name)
            .then(getOrNotFound)
            .then((attachment) => Audit.log(request.auth.actor(), 'update', attachment)
              .then(() => attachment))
        ]).then(([ blob, attachment ]) => attachment.with({ blobId: blob.id }).update())
          .then(success)))));

  service.delete('/forms/:id/attachments/:name', endpoint(({ all, Audit, Form, FormAttachment }, { params, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('update', form)
        .then(() => FormAttachment.getByFormAndName(form.id, params.name)
          .then(getOrNotFound)
          .then((attachment) => ((attachment.blobId == null)
            ? reject(Problem.user.notFound())
            : all.do([
              attachment.with({ blobId: null }).update(),
              Audit.log(auth.actor(), 'update', attachment) // technically not deleting it.
            ])
              .then(success)))))));
};

