
const { isBlank } = require('../util/util');
const { resolve, getOrNotFound } = require('../util/promise');
const { contentType, atom, xml, json } = require('../util/http');
const { odataEndpoint } = require('../http/endpoint');
const { serviceDocumentFor, edmxFor, rowStreamToOData, singleRowToOData } = require('../outbound/odata');

module.exports = (service, { all, Form, Submission }) => {
  // serves a service document comprising the primary dataset and any implicit
  // subtables created via repeats (section 11.1.1).
  service.get('/forms/:id.svc', odataEndpoint.json(({ all, auth, params, originalUrl }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => contentType('application/json; odata.metadata=minimal')(serviceDocumentFor(form, originalUrl)))));

  // serves a metadata document describing the entities in this form
  // (section 11.1.2/CSDL). does not enforce json, since EDMX is the only
  // specification format.
  service.get('/forms/:id.svc/([\$])metadata', odataEndpoint.xml(({ auth, params }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => xml(edmxFor(form)))));

  // serves filtered single-row data.
  service.get(/^\/forms\/([A-Za-z0-9-_]+).svc\/Submissions\(\'((?:uuid:)?[a-z0-9-]+)\'\)(\/.*)*$/, odataEndpoint.json(({ auth, params, query, originalUrl }) =>
    Form.getByXmlFormId(params[0]) // first regexp match
      .then(getOrNotFound)
      .then((form) => Submission.getById(form.id, params[1])
        .then(getOrNotFound)
        .then((submission) => json(singleRowToOData(form, submission, query, originalUrl))))));

  // serves table data.
  service.get('/forms/:id.svc/:table', odataEndpoint.json(({ auth, params, query, originalUrl }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => all.do([
        Submission.streamRowsForOdata(form.id, query),
        (!isBlank(query['$top']) || !isBlank(query['$count']))
          ? Submission.countByFormId(form.id)
          : resolve(null)
      ])
        .then(([ stream, count ]) => json(rowStreamToOData(form, params.table, query, originalUrl, stream, count))))));
};

