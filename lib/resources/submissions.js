const { endpoint, getOrNotFound } = require('../util/http');

module.exports = (service, { Submission, Form }) => {
  // Nonstandard REST; ODK-specific API.
  service.post('/submissions', endpoint(({ body, session }) =>
    Submission.fromXml(body)
      .then((partial) => Form.getByXmlFormId(partial.xmlFormId)
        .then(getOrNotFound) // TODO: detail why
        .then((form) => session.canOrReject('createSubmission', form)
          .then(() => partial.complete(form, session.actor).create())))))
};


