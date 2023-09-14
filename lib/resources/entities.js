// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound, reject } = require('../util/promise');
const { isTrue, success, withEtag } = require('../util/http');
const { Entity } = require('../model/frames');
const Problem = require('../util/problem');
const { diffEntityData } = require('../data/entity');

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/datasets/:name/entities', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.list', dataset);

    return Entities.getAll(dataset.id, queryOptions);
  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);


    const entity = await Entities.getById(dataset.id, params.uuid, queryOptions).then(getOrNotFound);

    return withEtag(entity.aux.currentVersion.version, () => entity);
  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid/versions', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    const defs = await Entities.getAllDefs(dataset.id, params.uuid, queryOptions);

    // it means there's no entity with the provided UUID
    if (defs.length === 0) return reject(Problem.user.notFound());

    return defs;
  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid/diffs', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    const defs = await Entities.getAllDefs(dataset.id, params.uuid, queryOptions);

    // it means there's no entity with the provided UUID
    if (defs.length === 0) return reject(Problem.user.notFound());

    return diffEntityData(defs.map(d => ({ label: d.label, ...d.data })));

  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid/audits', endpoint(async ({ Datasets, Entities, Audits }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    const entity = await Entities.getById(dataset.id, params.uuid, queryOptions).then(getOrNotFound);

    return Audits.getByEntityId(entity.id, queryOptions);

  }));

  service.post('/projects/:id/datasets/:name/entities', endpoint(async ({ Datasets, Entities }, { auth, body, params, userAgent }) => {

    const dataset = await Datasets.get(params.id, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.create', dataset);

    const properties = await Datasets.getProperties(dataset.id);

    const partial = await Entity.fromJson(body, properties, dataset);

    const sourceId = await Entities.createSource();
    const entity = await Entities.createNew(dataset, partial, null, sourceId, userAgent);

    // Entities.createNew doesn't return enough information for a full response so re-fetch.
    return Entities.getById(dataset.id, entity.uuid).then(getOrNotFound);
  }));

  service.patch('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { auth, body, params, query, userAgent, headers }) => {

    const dataset = await Datasets.get(params.id, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.update', dataset);

    const entity = await Entities.getById(dataset.id, params.uuid).then(getOrNotFound);

    const clientEntityVersion = headers['if-match'] && headers['if-match'].replaceAll('"', '');
    const serverEntityVersion = entity.aux.currentVersion.version;

    if (clientEntityVersion !== serverEntityVersion.toString() && !isTrue(query.force)) {
      return reject(Problem.user.entityVersionConflict({ current: serverEntityVersion.toString(), provided: clientEntityVersion }));
    }

    const properties = await Datasets.getProperties(dataset.id);
    const partial = Entity.fromJson(body, properties, dataset, entity);

    const sourceId = await Entities.createSource();

    return Entities.createVersion(dataset, entity, partial.def.data, partial.def.label, serverEntityVersion + 1, sourceId, userAgent);
  }));

  service.delete('/projects/:projectId/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { auth, params, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.update', dataset);

    const entity = await Entities.getById(dataset.id, params.uuid, queryOptions).then(getOrNotFound);

    await Entities.del(entity, dataset);

    return success();

  }));
};
