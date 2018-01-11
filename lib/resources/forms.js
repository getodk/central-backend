const { endpoint } = require('../util/http');

module.exports = (service, { Actee, Form }) => {
  service.post('/forms', endpoint(({ body, auth }) =>
    auth.transacting
      .canOrReject('create', Actee.species('form'))
      .then(() => Form.fromXml(body))
      .then((form) => form.create())
      .then((savedForm) => auth.actor()
        .map((actor) => actor.grant('*', savedForm).then(() => savedForm))
        .orElse(savedForm))));

  // TODO: auth-check on form visibility. (probably not necessary for MVP)
  service.get('/forms/:id', endpoint(({ params }) =>
    Form.getByXmlFormId(params.id)));

  // TODO: ditto auth.
  // TODO: paging.
  service.get('/forms', endpoint(Form.getAll));
};

