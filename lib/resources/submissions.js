const { endpoint, getOrNotFound } = require('../util/http');

module.exports = (service, { Submission, Form }) => {
  // Nonstandard REST; ODK-specific API.
  service.post('/submissions', endpoint(({ body, session }) =>
    Submission.fromXml(body)
      .then((partial) => Form.getByXmlFormId(partial.xmlFormId)
        .then(getOrNotFound) // TODO: detail why
        .then((form) => session.canOrReject('createSubmission', form)
          .then(() => partial.complete(form, session.actor).create())))))

  // The remaining endpoints follow a more-standard REST subresource route pattern.
  // This first one performs the operation as the above.
  service.post('/forms/:id/submissions', endpoint(({ params, body, session }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => session.canOrReject('createSubmission', form)
        .then(() => Submission.fromXml(body)
          .then((partial) => partial.complete(form, session.actor).create())))))

  // TODO: paging.
  service.get('/forms/:id/submissions', endpoint(({ params, session }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => session.canOrReject('read', form)
        .then(() => Submission.getAllByFormId(form.id)))))
};


