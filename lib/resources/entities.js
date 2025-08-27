// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound, reject } = require('../util/promise');
const { isTrue, success } = require('../util/http');
const { Entity } = require('../model/frames');
const Problem = require('../util/problem');
const { diffEntityData, extractBulkSource, getWithConflictDetails } = require('../data/entity');
const { QueryOptions } = require('../util/db');

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/datasets/:name/entities', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.list', dataset);

    return Entities.getAll(dataset.id, queryOptions);
  }));

  service.get('/projects/:projectId/datasets/:name/entities/creators', endpoint(async ({ Datasets, Entities }, { params, auth }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    return Entities.getAllCreators(dataset.id);
  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);


    return Entities.getById(dataset.id, params.uuid, queryOptions).then(getOrNotFound);
  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid/versions', endpoint(async ({ Datasets, Entities, Audits }, { params, auth, queryOptions, query }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    const defs = await Entities.getAllDefs(dataset.id, params.uuid, queryOptions);

    // it means there's no entity with the provided UUID
    if (defs.length === 0) return reject(Problem.user.notFound());

    const audits = await Audits.getByEntityId(defs[0].entityId, queryOptions);

    return getWithConflictDetails(defs, audits, isTrue(query.relevantToConflict));
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

  // Create a single entity or bulk create multiple entities.
  // In either case, this appends new entities to a dataset.
  service.post('/projects/:id/datasets/:name/entities', endpoint(async ({ Datasets, Entities }, { auth, body, params, userAgent }) => {
    const dataset = await Datasets.get(params.id, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.create', dataset);

    const properties = await Datasets.getProperties(dataset.id);

    // Destructure list of new entities and source if bulk operation
    const { entities, source } = body;

    if (!entities) {
      // not a bulk operation
      const partial = await Entity.fromJson(body, properties, dataset);
      const sourceId = await Entities.createSource();
      const entity = await Entities.createNew(dataset, partial, null, sourceId, userAgent);
      // Entities.createNew doesn't return enough information for a full response so re-fetch.
      return Entities.getById(dataset.id, entity.uuid).then(getOrNotFound);
    } else {
      // bulk operation
      if (!Array.isArray(body.entities))
        return reject(Problem.user.unexpectedAttributes({ expected: ['entities: [...]'], actual: ['not an array'] }));

      if (!body.entities.length)
        return reject(Problem.user.unexpectedAttributes({ expected: ['entities: [...]'], actual: ['empty array'] }));

      const partials = body.entities.map(e => Entity.fromJson(e, properties, dataset));

      const sourceId = await Entities.createSource(extractBulkSource(source, partials.length, userAgent));

      await Entities.createMany(dataset, partials, sourceId, userAgent);
      return success();
    }

  }));

  service.patch('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { auth, body, params, query, userAgent }) => {

    const dataset = await Datasets.get(params.id, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.update', dataset);

    const entity = await Entities.getById(dataset.id, params.uuid, QueryOptions.forUpdate).then(getOrNotFound);

    // User trying to resolve when there is no conflict
    if (isTrue(query.resolve) && !entity.conflict) return reject(Problem.user.noConflictEntity());

    // TODO: more validation? what if it's not a number or something else weird?
    const clientEntityVersion = query.baseVersion;
    const serverEntityVersion = entity.aux.currentVersion.version; // aka baseVersion

    if (clientEntityVersion !== serverEntityVersion.toString() && !isTrue(query.force)) {
      return reject(Problem.user.entityVersionConflict({ current: serverEntityVersion.toString(), provided: clientEntityVersion }));
    }

    // User just wants to resolve the conflict, so body is empty
    // Resolve the conflict and shortcircuit
    if (isTrue(query.resolve) && (!body || Object.keys(body).length === 0)) {
      return Entities.resolveConflict(entity, dataset);
    }

    const properties = await Datasets.getProperties(dataset.id);
    const partial = Entity.fromJson(body, properties, dataset, entity);

    const sourceId = await Entities.createSource();

    const updatedEntity = await Entities.createVersion(dataset, partial, null, serverEntityVersion + 1, sourceId, serverEntityVersion, userAgent);

    // User wants to resolve conflict in addition to update the Entity
    if (isTrue(query.resolve)) {
      return Entities.resolveConflict(updatedEntity, dataset);
    }

    return updatedEntity;

  }));

  service.delete('/projects/:projectId/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { auth, params }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.delete', dataset);

    const entity = await Entities.getById(dataset.id, params.uuid).then(getOrNotFound);

    await Entities.del(entity, dataset);

    return success();

  }));

  service.post('/projects/:projectId/datasets/:name/entities/:uuid/restore', endpoint(async ({ Datasets, Entities }, { auth, params }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.restore', dataset);

    const entity = await Entities.getById(dataset.id, params.uuid, new QueryOptions({ argData: { deleted: 'true' } })).then(getOrNotFound);

    await Entities.restore(entity, dataset);

    return success();
  }));
};
