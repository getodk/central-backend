const path = require('path');
const { endpoint, openRosaEndpoint, odataEndpoint, getOrNotFound, contentType, atom, xml } = require('../util/http');
const { formList } = require('../outbound/openrosa');
const { xmlServiceDocumentFor, jsonServiceDocumentFor, edmxFor, rowStreamToAtom, rowStreamToJson } = require('../outbound/odata');

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

  // TODO: pull odata out into its own file.
  // serves a service document comprising the primary dataset and any implicit
  // subtables created via repeats (section 11.1.1).
  service.get('/forms/:id.svc', odataEndpoint(({ auth, params, originalUrl, odataFormat }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => (odataFormat === 'atom')
        ? contentType('application/atomsvc+xml')(xmlServiceDocumentFor(form, originalUrl))
        : contentType('application/json; odata.metadata=minimal')(jsonServiceDocumentFor(form, originalUrl)))));

  // serves a metadata document describing the entities in this form
  // (section 11.1.2/CSDL). does not enforce json, since EDMX is the only
  // specification format.
  service.get('/forms/:id.svc/([\$])metadata', odataEndpoint(({ auth, params }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => xml(edmxFor(form)))));

  // serves table data.
  service.get('/forms/:id.svc/Submissions', odataEndpoint(({ auth, params, originalUrl, odataFormat }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => Submission.streamRowsByFormId(form.id)
        .then((stream) => (odataFormat === 'atom')
          ? xml(rowStreamToAtom(form, originalUrl, stream))
          : rowStreamToJson(form, originalUrl, stream)))));

  service.get('/forms/:id', endpoint(({ auth, params, extended }) =>
    Form.getByXmlFormId(params.id, extended)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => form))));

};

