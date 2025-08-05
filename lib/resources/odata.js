// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Form } = require('../model/frames');
const { ensureDef } = require('../model/frame');
const { getOrNotFound, resolve } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { contentType, xml, json } = require('../util/http');
const Problem = require('../util/problem');
const { serviceDocumentFor, edmxFor, rowStreamToOData, singleRowToOData, selectFields, getTableFromOriginalUrl } = require('../formats/odata');

module.exports = (service, endpoint) => {

  ////////////////////////////////////////////////////////////////////////////////
  // GENERIC ODATA RESOURCE

  const odataResource = (base, draft, getForm) => {
    // serves a service document comprising the primary dataset and any implicit
    // subtables created via repeats (section 11.1.1).
    service.get(base, endpoint.odata.json(({ Forms, env }, { auth, params, originalUrl }) =>
      getForm(Forms, auth, params)
        .then((form) => Forms.getFields(form.def.id))
        .then((fields) => serviceDocumentFor(fields, env.domain, originalUrl))
        .then(contentType('application/json; odata.metadata=minimal'))));

    // serves a metadata document describing the entities in this form
    // (section 11.1.2/CSDL). does not enforce json, since EDMX is the only
    // specification format.
    service.get(`${base}/([$])metadata`, endpoint.odata.xml(({ Forms }, { auth, params }) =>
      getForm(Forms, auth, params)
        .then((form) => Forms.getFields(form.def.id)
          .then((fields) => xml(edmxFor(form.xmlFormId, fields))))));

    // serves filtered single-row data.
    const uuidRegex = /^'((?:uuid:)?[a-z0-9-]+)'$/i;
    const getUuid = (str) => {
      const matches = uuidRegex.exec(str);
      if (matches == null) throw Problem.user.notFound();
      return matches[1];
    };

    const singleRecord = endpoint.odata.json(async ({ Forms, Submissions, env }, { auth, params, query, originalUrl }) => {
      const form = await getForm(Forms, auth, params);
      const allFields = await Forms.getFields(form.def.id);
      const selectedFields = selectFields(query, getTableFromOriginalUrl(originalUrl))(allFields);
      const row = await Submissions.getForExport(form.id, getUuid(params.uuid), draft).then(getOrNotFound);
      return singleRowToOData(selectedFields, row, env.domain, originalUrl, query);
    });

    // TODO: because of the way express compiles the *, we have to register this twice.
    service.get(`${base}/Submissions\\(:uuid\\)`, singleRecord);
    service.get(`${base}/Submissions\\(:uuid\\)/*`, singleRecord);

    // serves table data.
    service.get(`${base}/:table`, endpoint.odata.json(({ Forms, Submissions, env }, { auth, params, originalUrl, query }) =>
      getForm(Forms, auth, params)
        .then((form) => {
          const options = QueryOptions.fromODataRequest(params, query);
          return Promise.all([
            Forms.getFields(form.def.id).then(selectFields(query, params.table)),
            Submissions.streamForExport(form.id, draft, undefined, options),
            ((params.table === 'Submissions') && options.hasPaging())
              ? Submissions.countByFormId(form.id, draft, options) : resolve({})
          ])
            .then(([fields, stream, { count, remaining }]) =>
              json(rowStreamToOData(fields, params.table, env.domain, originalUrl, query, stream, count, remaining)));
        })));
  };


  ////////////////////////////////////////////////////////////////////////////////
  // REIFY ODATA RESOURCES

  odataResource('/projects/:projectId/forms/:id.svc', false, (Forms, auth, params) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, Form.PublishedVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then((form) => auth.canOrReject('submission.read', form)));

  odataResource('/projects/:projectId/forms/:id/draft.svc', true, (Forms, auth, params) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id, Form.DraftVersion)
      .then(getOrNotFound)
      .then(ensureDef)
      .then((form) => auth.canOrReject('submission.read', form)));
};

