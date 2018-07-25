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
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const { formList } = require('../outbound/openrosa');

module.exports = (service, { env, Actee, Form, Audit }) => {
  // TODO: per-form read auth.
  // TODO: paging.
  // TODO: possibly omit xml.
  service.get('/forms', endpoint(({ auth, extended }) =>
    auth.canOrReject('list', Actee.species('form'))
      .then(() => Form.getAll(extended))));

  // non-REST openrosa endpoint for formlist.
  // TODO: per-form read auth.
  service.get('/formList', openRosaEndpoint(({ auth, originalUrl }) =>
    auth.canOrReject('list', Actee.species('form'))
      .then(() => Form.getOpen(false))
      .then((forms) => formList({ forms, basePath: path.resolve(originalUrl, '..'), domain: env.domain }))));

  service.post('/forms', endpoint(({ body, auth }) =>
    auth.transacting
      .canOrReject('create', Actee.species('form'))
      .then(() => Form.fromXml(body))
      .then((form) => form.create())
      .then((form) => Audit.log(auth.actor(), 'createForm', form)
        .then(() => form))));

  // get just the XML of the form; used for downloading forms from collect.
  service.get('/forms/:id.xml', endpoint(({ params, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => xml(form.xml)))));

  service.get('/forms/:id.schema.json', endpoint(({ params, query, auth }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => form.schema()
          .then(isTrue(query.flatten) ? flattenSchemaStructures : identity)))));

  service.get('/forms/:id', endpoint(({ auth, params, extended }) =>
    Form.getByXmlFormId(params.id, extended)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => form))));

  service.patch('/forms/:id', endpoint(({ auth, params, body }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('update', form)
        .then(() => form.with(Form.fromApi(body)).update())
        .then(success))));

  service.delete('/forms/:id', endpoint(({ auth, params }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('delete', form)
        .then(() => form.delete())
        .then(success))));
};

