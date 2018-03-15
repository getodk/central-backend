
const { isBlank } = require('../util/util');
const { resolve, getOrNotFound } = require('../util/promise');
const { contentType, atom, xml, json } = require('../util/http');
const { odataEndpoint } = require('../http/endpoint');
const { xmlServiceDocumentFor, jsonServiceDocumentFor, edmxFor, rowStreamToAtom, rowStreamToJson } = require('../outbound/odata');

module.exports = (service, { all, Form, Submission }) => {
  // serves a service document comprising the primary dataset and any implicit
  // subtables created via repeats (section 11.1.1).
  service.get('/forms/:id.svc', odataEndpoint(({ all, auth, params, originalUrl, odataFormat }) =>
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
  service.get('/forms/:id.svc/:table', odataEndpoint(({ auth, params, query, originalUrl, odataFormat }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => all.do([
        Submission.streamRowsForOdata(form.id, query),
        (!isBlank(query['$top']) || !isBlank(query['$count']))
          ? Submission.countByFormId(form.id)
          : resolve(null)
      ])
        .then(([ stream, count ]) => (odataFormat === 'atom')
          ? xml(rowStreamToAtom(form, params.table, originalUrl, stream))
          : json(rowStreamToJson(form, params.table, query, originalUrl, stream, count))))));
};

