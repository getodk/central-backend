const path = require('path');
const { endpoint, openRosaEndpoint } = require('../http/endpoint');
const { getOrNotFound } = require('../util/promise');
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
  service.get('/forms/:id.xml', endpoint(({ params, auth }, response) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => {
          response.type('xml'); // TODO: smoother way to set this.
          return form.xml;
        }))));

  service.get('/forms/:id', endpoint(({ auth, params, extended }) =>
    Form.getByXmlFormId(params.id, extended)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => form))));
};

