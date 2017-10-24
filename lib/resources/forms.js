const { endpoint } = require('../util/http');

module.exports = (service, { Form }) => {

  service.post('/forms', endpoint(({ body }) =>
    Form.fromXml(body).then((form) => form.create())
  ));

  /*
  service.post('/forms', endpoint((request) =>
    doIf(Session.for(request), 'create', 'form',
      Form.fromXml(body).then((form) => form.create())
    )
  ));
  */

  service.get('/forms/:id', endpoint(({ params }) =>
    Form.getByXmlFormId(params.id)
  ));

};

