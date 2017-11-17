const { endpoint } = require('../util/http');

module.exports = (service, { Actee, Form }) => {
  service.post('/forms', endpoint(({ body, session }) =>
    session.transacting
      .canOrReject('create', Actee.species('form'))
      .then(() => Form.fromXml(body))
      .then((form) => form.create())
      .then((savedForm) => (session.actor.isDefined()
        ? session.actor.get().grant('*', savedForm).then(() => savedForm)
        : savedForm))));

  // TODO: auth-check on form visibility. (probably not necessary for MVP)
  service.get('/forms/:id', endpoint(({ params }) =>
    Form.getByXmlFormId(params.id)));
};

