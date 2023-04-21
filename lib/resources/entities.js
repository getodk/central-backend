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
const Problem = require('../util/problem');
const { parseUpdateJson, diffEntityData } = require('../data/entity');

const getActor = () => ({
  id: 1,
  displayName: 'John Doe',
  type: 'user',
  createdAt: new Date(),
  updatedAt: null,
  deletedAt: null
});
const getEntityDef = () => ({
  versionNumber: 1,
  label: '',
  current: true,
  createdAt: '2023-01-01T09:00:00.000Z',
  creatorId: 1,
  userAgent: 'Postman'
});

const getEntity = (i) => ({
  uuid: `00000000-0000-0000-0000-00000000000${i}`,
  createdAt: '2023-01-01T09:00:00.000Z',
  updatedAt: null,
  deletedAt: null,
  creatorId: 1
});

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/datasets/:name/entities', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.list', dataset);

    return Entities.getAll(dataset.id, queryOptions);
  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    return Entities.getById(dataset.id, params.uuid, queryOptions).then(getOrNotFound);
  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid/versions', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    const defs = await Entities.getAllDefs(dataset.id, params.uuid, queryOptions);

    // it means there's no entity with the provided UUID
    if (defs.length === 0) return reject(Problem.user.notFound());

    return defs;
  }));

  // May not be needed for now
  service.get('/projects/:id/datasets/:name/entities/:uuid/versions/:versionNumber', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    return {
      ...getEntityDef(),
      current: false,
      source: {
        type: 'api',
        details: null
      },
      data: {
        firstName: 'Janie',
        lastName: 'Doe',
        city: 'Toronto'
      },
      versionNumber: params.versionNumber,
      label: 'Janie Doe',
      createdAt: new Date()
    };

  }));

  service.get('/projects/:projectId/datasets/:name/entities/:uuid/diffs', endpoint(async ({ Datasets, Entities }, { params, auth, queryOptions }) => {

    const dataset = await Datasets.get(params.projectId, params.name, true).then(getOrNotFound);

    await auth.canOrReject('entity.read', dataset);

    const defs = await Entities.getAllDefs(dataset.id, params.uuid, queryOptions);

    // it means there's no entity with the provided UUID
    if (defs.length === 0) return reject(Problem.user.notFound());

    return diffEntityData(defs.map(d => ({ label: d.label, ...d.data })));

  }));

  service.get('/projects/:id/datasets/:name/entities/:uuid/audits', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    return [
      {
        actorId: 1,
        action: 'entity.update.version',
        acteeId: '11111111-1111-1111-11111111111111111',
        details: {
          entityId: '00000000-0000-0000-0000-000000000001',
          label: 'Jane Roe',
          versionNumber: 2,
          source: {
            type: 'api',
            details: null
          }
        },
        loggedAt: '2023-01-02T09:00:00.000Z',
        notes: null,
        actor: getActor()
      },
      {
        actorId: 1,
        action: 'entity.create',
        acteeId: '11111111-1111-1111-11111111111111111',
        details: {
          entityId: '00000000-0000-0000-0000-000000000001',
          label: 'John Doe',
          versionNumber: 1,
          source: {
            type: 'submission',
            details: {
              instanceId: '11111111-1111-1111-11111111111111111',
              instanceName: 'first instance',
              xmlFormId: 'submission'
            }
          },
          // This nesting needs to be discussed
          relatedEvents: [
            {
              actorId: 1,
              action: 'submission.update',
              acteeId: '11111111-1111-1111-511c9466b12c',
              details: {
                instanceId: 'uuid:f9636668-814c-4450-859e-e651f3d81fd5',
                submissionId: 359983,
                reviewState: 'approved'
              },
              loggedAt: '2023-01-01T09:00:00.000Z',
              notes: null,
              actor: getActor()
            },
            {
              actorId: 1,
              action: 'submission.create',
              acteeId: '11111111-1111-1111-511c9466b12c',
              details: {
                instanceId: 'uuid:f9636668-814c-4450-859e-e651f3d81fd5',
                submissionId: 359983,
                instanceName: 'Lorem ipsum'
              },
              loggedAt: '2023-01-01T09:00:00.000Z',
              notes: null,
              actor: getActor()
            }
          ]
        },
        loggedAt: '2023-01-01T09:00:00.000Z',
        notes: null,
        actor: getActor()
      }
    ];
  }));

  service.post('/projects/:id/datasets/:name/entities', endpoint(async ({ Projects }, { params, queryOptions, body, headers }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    const { uuid, label, ...data } = body;

    const date = new Date();

    const userAgent = headers['user-agent'];

    const entity = {
      ...getEntity(1),
      uuid,
      createdAt: date,
      currentVersion: {
        ...getEntityDef(),
        sourceId: userAgent,
        source: {
          type: 'api',
          details: null
        },
        label,
        createdAt: date,
        data
      }
    };

    return entity;

  }));

  service.put('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Projects }, { params, queryOptions, body, headers }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    const { uuid, label, ...data } = body;

    const updatedAt = new Date();

    const userAgent = headers['user-agent'];

    const entity = {
      ...getEntity(1),
      uuid,
      createdAt: '2023-01-01T09:00:00.000Z',
      updatedAt,
      currentVersion: {
        ...getEntityDef(),
        userAgent,
        versionNumber: 2,
        source: {
          type: 'api',
          details: null
        },
        label,
        createdAt: updatedAt,
        data
      }
    };

    return entity;

  }));

  service.patch('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Datasets, Entities }, { auth, body, headers, params, query }) => {

    const dataset = await Datasets.get(params.id, params.name).then(getOrNotFound);

    await auth.canOrReject('entity.update', dataset);

    const entity = await Entities.getById(dataset.id, params.uuid).then(getOrNotFound);

    if (!isTrue(query.force)) return reject(Problem.internal.notImplemented({ feature: '(updating an entity without ?force=true flag)' }));

    const properties = await Datasets.getProperties(dataset.id);
    const { data, label } = parseUpdateJson(entity, properties, body);

    return Entities.createVersion(dataset, entity, data, label, headers['user-agent']);
  }));

  service.delete('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    return success();

  }));

  // Lowest priority
  service.post('/projects/:id/datasets/:name/entities/:uuid/restore', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    const entity = getEntity(1);
    entity.updatedAt = '2023-01-02T09:00:00.000Z';
    entity.currentVersion = {
      ...getEntityDef(),
      source: {
        type: 'api',
        details: null
      },
      data: {
        firstName: 'Jane',
        lastName: 'Roe',
        city: 'Toronto'
      },
      versionNumber: 1,
      label: 'Jane Roe',
      createdAt: '2023-01-03T09:00:00.000Z'
    };
    return entity;

  }));
};
