const path = require('path');
const { endpoint, openRosaEndpoint, getOrNotFound, getOrReject } = require('../util/http');
const { formList } = require('../outbound/openrosa');
const { resolve } = require('../reused/promise');
const Problem = require('../problem');

module.exports = (service, { Actee, Form }) => {
  service.post('/forms', endpoint(({ body, auth }) =>
    auth.transacting
      .canOrReject('create', Actee.species('form'))
      .then(() => Form.fromXml(body))
      .then((form) => form.create())
      .then((savedForm) => auth.actor()
        .map((actor) => actor.grant('*', savedForm).then(() => savedForm))
        .orElse(savedForm))));

  // non-REST openrosa endpoint for formlist.
  // TODO: per-form read auth.
  service.get('/formList', openRosaEndpoint(({ auth, originalUrl }) =>
    auth.canOrReject('list', Actee.species('form'))
      .then(Form.getAll)
      .then((forms) => formList(200, { forms, basePath: path.resolve(originalUrl, '..') }))));

  // get just the XML of the form; used for downloading forms from collect.
  service.get('/forms/:id.xml', endpoint(({ params, auth }, response) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => {
          response.type('xml'); // TODO: smoother way to set this.
          return form.xml
        }))));

  // TODO: auth-check on form visibility. (probably not necessary for MVP)
  service.get('/forms/:id', endpoint(({ params }) =>
    Form.getByXmlFormId(params.id)));

  // TODO: ditto auth.
  // TODO: paging.
  service.get('/forms', endpoint(Form.getAll));
};

