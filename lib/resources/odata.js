// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound, resolve } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { contentType, xml, json } = require('../util/http');
const { serviceDocumentFor, edmxFor, rowStreamToOData, singleRowToOData } = require('../outbound/odata');

module.exports = (service, endpoint) => {
  // serves a service document comprising the primary dataset and any implicit
  // subtables created via repeats (section 11.1.1).
  service.get('/projects/:projectId/forms/:id.svc', endpoint.odata.json(({ Project, env }, { auth, params, originalUrl }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.read', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => form.def.getFields())
        .then((fields) => serviceDocumentFor(fields, env.domain, originalUrl))
        .then(contentType('application/json; odata.metadata=minimal')))));

  // serves a metadata document describing the entities in this form
  // (section 11.1.2/CSDL). does not enforce json, since EDMX is the only
  // specification format.
  service.get('/projects/:projectId/forms/:id.svc/([$])metadata', endpoint.odata.xml(({ Project }, { auth, params }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.read', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => form.def.getFields()
          .then((fields) => xml(edmxFor(form.xmlFormId, fields)))))));

  // serves filtered single-row data.
  const singleRowRegex = /^\/projects\/(\d+)\/forms\/([a-z0-9-_]+).svc\/Submissions\((?:'|%27)((?:uuid:)?[a-z0-9-]+)(?:'|%27)\)(\/.*)*$/i;
  service.get(singleRowRegex, endpoint.odata.json(({ Project, SubmissionDef, env }, { auth, params, query, originalUrl }) =>
    Project.getById(params[0]) // first regexp match
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.read', project)
        .then(() => project.getFormByXmlFormId(params[1])) // second match
        .then(getOrNotFound)
        .then((form) => Promise.all([
          form.def.getFields(),
          SubmissionDef.getForExport(form.id, params[2], false).then(getOrNotFound)
        ])
          .then(([ fields, row ]) => singleRowToOData(form.xmlFormId, fields, row, env.domain, decodeURI(originalUrl), query))))));

  // serves table data.
  service.get('/projects/:projectId/forms/:id.svc/:table', endpoint.odata.json(({ Project, Submission, SubmissionDef, env }, { auth, params, originalUrl, query }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('form.read', project)
        .then(() => project.getFormByXmlFormId(params.id))
        .then(getOrNotFound)
        .then((form) => {
          const options = QueryOptions.fromODataRequest(params, query);
          return Promise.all([
            form.def.getFields(),
            SubmissionDef.streamForExport(form.id, false, undefined, options),
            ((params.table === 'Submissions') && options.hasPaging())
              ? Submission.countByFormId(form.id, false) : resolve(null)
          ])
            .then(([ fields, stream, count ]) =>
              json(rowStreamToOData(form.xmlFormId, fields, params.table, env.domain, originalUrl, query, stream, count)));
        }))));
};

