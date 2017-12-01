const { always } = require('ramda');
const { openRosaEndpoint, endpoint, getOrNotFound } = require('../util/http');
const { openRosaMessage } = require('../util/openrosa');
const { streamDataZip } = require('../data/csv');

module.exports = (service, { Submission, Form }) => {
  // Nonstandard REST; OpenRosa-specific API.
  // This bit of silliness is to address the fact that the OpenRosa standards
  // specification requires the presence of a HEAD /submission endpoint, but
  // does not specify the presence of GET /submission. in order to fulfill that
  // spec without violating the HTTP spec, we have to populate GET /submission
  // with something silly.
  service.get('/submission', endpoint(() =>
    ({ message: "You should use POST to submit to /submission." })));

  // Nonstandard REST; OpenRosa-specific API.
  // TODO: multiple POSTS should apparently amend the multimedia slate?
  service.post('/submission', openRosaEndpoint(({ body, session }) =>
    Submission.fromXml(body)
      .then((partial) => Form.getByXmlFormId(partial.xmlFormId)
        .then(getOrNotFound) // TODO: detail why
        .then((form) => session.canOrReject('createSubmission', form)
          .then(() => partial.complete(form, session.actor).create())
          .then(always(openRosaMessage(201, { message: 'full submission upload was successful!' })))))));

  // The remaining endpoints follow a more-standard REST subresource route pattern.
  // This first one performs the operation as the above.
  service.post('/forms/:id/submissions', endpoint(({ params, body, session }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => session.canOrReject('createSubmission', form)
        .then(() => Submission.fromXml(body)
          .then((partial) => partial.complete(form, session.actor).create())))))

  service.get('/forms/:id/submissions.csv.zip', endpoint(({ params, session }, response) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => session.canOrReject('read', form)
        .then(() => Submission.streamAllByFormId(form.id)
          .then((stream) =>{
            // TODO: sanitize form id?
            response.append('Content-Disposition', `attachment; filename=${form.xmlFormId}.zip`);
            return streamDataZip(stream, form);
          })))));

  // TODO: paging.
  service.get('/forms/:id/submissions', endpoint(({ params, session }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => session.canOrReject('read', form)
        .then(() => Submission.getAllByFormId(form.id)))))

  service.get('/forms/:formId/submissions/:instanceId', endpoint(({ params, session }) =>
    Form.getByXmlFormId(params.formId)
      .then(getOrNotFound)
      .then((form) => session.canOrReject('read', form)
        .then(() => Submission.getById(form.id, params.instanceId)))))
};


