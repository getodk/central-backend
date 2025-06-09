// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const { getOrNotFound } = require('../util/promise');
const { QueryOptions } = require('../util/db');
const { json, contentType, xml } = require('../util/http');
const { streamEntityOdata } = require('../data/entity');
const { urlPathname } = require('../util/http');
const { edmxForEntities } = require('../formats/odata');

module.exports = (service, endpoint) => {

  const serviceDocument = (domain, originalUrl) => ({
    '@odata.context': `${domain}${urlPathname(originalUrl)}/$metadata`,
    value: [{ name: 'Entities', kind: 'EntitySet', url: 'Entities' }]
  });

  // serves a service document comprising the primary dataset and any implicit
  service.get('/projects/:projectId/datasets/:name.svc', endpoint.odata.json(async ({ Datasets, Projects, env }, { auth, params, originalUrl }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('entity.list', project);
    await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);
    return contentType('application/json; odata.metadata=minimal')(serviceDocument(env.domain, originalUrl));
  }));

  // serves a metadata document describing the properties in the Dataset
  service.get('/projects/:projectId/datasets/:name.svc/([$])metadata', endpoint.odata.xml(async ({ Datasets, Projects }, { auth, params }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('entity.list', project);
    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);
    const properties = await Datasets.getProperties(dataset.id);
    return xml(edmxForEntities(params.name, properties));
  }));

  // serves the odata feed for the entities
  service.get('/projects/:projectId/datasets/:name.svc/Entities', endpoint.odata.json(async ({ Datasets, Entities, Projects, env }, { auth, params, originalUrl, query }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('entity.list', project);
    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);
    const properties = await Datasets.getProperties(dataset.id);
    const options = QueryOptions.fromODataRequestEntities(query);
    const { count, remaining } = await Entities.countByDatasetId(dataset.id, options);
    const entities = await Entities.streamForExport(dataset.id, null, options);
    return json(streamEntityOdata(entities, properties, env.domain, originalUrl, query, count, remaining));
  }));


};

