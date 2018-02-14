
const { odataEndpoint, getOrNotFound, contentType, atom, xml, json } = require('../util/http');
const { xmlServiceDocumentFor, jsonServiceDocumentFor, edmxFor, rowStreamToAtom, rowStreamToJson } = require('../outbound/odata');

module.exports = (service, { Form, Submission }) => {
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
  service.get('/forms/:id.svc/Submissions', odataEndpoint(({ auth, params, query, originalUrl, odataFormat }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => Submission.streamRowsForOdata(form.id, query)
        .then((stream) => (odataFormat === 'atom')
          ? xml(rowStreamToAtom(form, originalUrl, stream))
          : json(rowStreamToJson(form, query, originalUrl, stream))))));
};

