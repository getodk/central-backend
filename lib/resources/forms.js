const path = require('path');
const { xml } = require('../util/http');
const { endpoint, openRosaEndpoint } = require('../http/endpoint');
const { getOrNotFound } = require('../util/promise');
const { formList } = require('../outbound/openrosa');

module.exports = (service, { Actee, Form, Audit, Submission }) => {
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
      .then(Form.getAll)
      .then((forms) => formList(200, { forms, basePath: path.resolve(originalUrl, '..') }))));

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

  service.get('/forms/:id', endpoint(({ auth, params, extended }) =>
    Form.getByXmlFormId(params.id, extended)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => form))));

};

