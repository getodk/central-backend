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
  service.get('/forms/:id.svc', endpoint.odata.json(({ Form, env }, { auth, params, originalUrl }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => contentType('application/json; odata.metadata=minimal')(serviceDocumentFor(form, env.domain, originalUrl))))));

  // serves a metadata document describing the entities in this form
  // (section 11.1.2/CSDL). does not enforce json, since EDMX is the only
  // specification format.
  service.get('/forms/:id.svc/([$])metadata', endpoint.odata.xml(({ Form }, { auth, params }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => xml(edmxFor(form))))));

  // serves filtered single-row data.
  const singleRowRegex = /^\/forms\/([a-z0-9-_]+).svc\/Submissions\((?:'|%27)((?:uuid:)?[a-z0-9-]+)(?:'|%27)\)(\/.*)*$/i;
  service.get(singleRowRegex, endpoint.odata.json(({ Form, Submission, env }, { auth, params, query, originalUrl }) =>
    Form.getByXmlFormId(params[0]) // first regexp match
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => Submission.getById(form.id, params[1], QueryOptions.extended)
          .then(getOrNotFound)
          .then((submission) => singleRowToOData(form, submission, env.domain, decodeURI(originalUrl), query))))));

  // serves table data.
  service.get('/forms/:id.svc/:table', endpoint.odata.json(({ all, Form, Submission, env }, { auth, params, originalUrl, query }) =>
    Form.getByXmlFormId(params.id)
      .then(getOrNotFound)
      .then((form) => auth.canOrReject('read', form)
        .then(() => QueryOptions.fromODataRequest(params, query))
        .then((options) => all.do([
          Submission.streamRowsByFormId(form.id, options),
          ((params.table === 'Submissions') && options.hasPaging())
            ? Submission.countByFormId(form.id) : resolve(null)
        ]))
        .then(([ stream, count ]) =>
          json(rowStreamToOData(form, params.table, env.domain, originalUrl, query, stream, count))))));
};

