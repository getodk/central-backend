// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound } = require('../util/promise');
const { mergeLeft } = require('ramda');
const { success } = require('../util/http');

const getActor = () => ({
  id: 1,
  displayName: 'John Doe',
  type: 'user',
  createdAt: new Date(),
  updatedAt: null,
  deletedAt: null
});
const getVersionSummary = () => ({
  versionNumber: 1,
  label: '',
  current: true,
  deleted: false,
  createdAt: '2023-01-01T09:00:00.000Z',
  creatorId: 1
});

const getEntitySummary = (i) => ({
  uuid: `00000000-0000-0000-0000-00000000000${i}`,
  datasetName: 'People',
  createdAt: '2023-01-01T09:00:00.000Z',
  updatedAt: null,
  deletedAt: null,
});

const populateEntities = () => {
  const entities = [];
  for (let i = 1; i <= 5; i+=1) {
    entities.push({
      ...getEntitySummary(i),
      currentVersion: getVersionSummary()
    });
  }
  return entities;
};

module.exports = (service, endpoint) => {

  service.get('/projects/:id/datasets/:name/entities', endpoint(async ({ Projects }, { params, queryOptions, query }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);
    const entities = populateEntities();

    if (queryOptions.extended) {
      for (let i = 0; i < 5; i+=1) {
        entities[i].currentVersion.creator = getActor();
      }
    }

    if (query.deleted) {
      entities[4].deletedAt = new Date();
      entities[4].currentVersion.deleted = true;
      entities[4].currentVersion.versionNumber = 2;
    }

    return entities;
  }));

  service.get('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);
    const entity = getEntitySummary(1);
    entity.updatedAt = '2023-01-02T09:00:00.000Z';
    entity.currentVersion = {
      ...getVersionSummary(),
      source: {
        type: 'API',
        id: 'super-client'
      },
      data: {
        firstName: 'Jane',
        lastName: 'Roe',
        city: 'Toronto'
      },
      versionNumber: 2,
      label: 'Jane Roe',
      createdAt: '2023-01-02T09:00:00.000Z'
    };
    return entity;
  }));

  service.get('/projects/:id/datasets/:name/entities/:uuid/versions', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    const versions = ['John Doe', 'Jane Doe', 'Richard Roe', 'Janie Doe', 'Baby Roe'].map((name, i) => ({
      ...getVersionSummary(),
      current: i === 4,
      source: {
        type: 'API',
        id: 'super-client'
      },
      data: {
        firstName: name.split(' ')[0],
        lastName: name.split(' ')[1],
        city: 'Toronto'
      },
      versionNumber: i+1,
      label: name,
      createdAt: new Date()
    }));

    return versions;
  }));

  service.get('/projects/:id/datasets/:name/entities/:uuid/versions/:versionNumber', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    return {
      ...getVersionSummary(),
      current: false,
      source: {
        type: 'API',
        id: 'super-client'
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

  service.get('/projects/:id/datasets/:name/entities/:uuid/diffs', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    return {
      2: [ // 2 is version number
        { old: 'John', new: 'Jane', propertyName: 'firstName' },
        { old: 'Doe', new: 'Roe', propertyName: 'lastName' },
        { old: 'John Doe', new: 'Jane Roe', propertyName: 'label' }
      ]
    };
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
          entitySource: 'API',
          entitySourceId: 'super-client'
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
          entitySource: 'SUBMISSION',
          entitySourceId: 'simpleForm/11111111-1111-1111-11111111111111111'
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

    const sourceId = headers['x-client-id'];

    const entity = {
      ...getEntitySummary(1),
      uuid,
      createdAt: date,
      currentVersion: {
        ...getVersionSummary(),
        source: {
          type: 'API',
          id: sourceId
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

    const sourceId = headers['x-client-id'];

    const entity = {
      ...getEntitySummary(1),
      uuid,
      createdAt: '2023-01-01T09:00:00.000Z',
      updatedAt,
      currentVersion: {
        ...getVersionSummary(),
        versionNumber: 2,
        source: {
          type: 'API',
          id: sourceId
        },
        label,
        createdAt: updatedAt,
        data
      }
    };

    return entity;

  }));

  service.patch('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Projects }, { params, queryOptions, body, headers }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    const originalData = {
      uuid: '10000000-0000-0000-0000-000000000001',
      label: 'Johnny Doe',
      firstName: 'Johnny',
      lastName: 'Doe',
      city: 'Toronto'
    };

    const { uuid, label, ...data } = mergeLeft(body, originalData);

    const updatedAt = new Date();

    const sourceId = headers['x-client-id'];

    const entity = {
      ...getEntitySummary(1),
      uuid,
      createdAt: '2023-01-01T09:00:00.000Z',
      updatedAt,
      currentVersion: {
        ...getVersionSummary(),
        versionNumber: 2,
        source: {
          type: 'API',
          id: sourceId
        },
        label,
        createdAt: updatedAt,
        data
      }
    };

    return entity;

  }));

  service.delete('/projects/:id/datasets/:name/entities/:uuid', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    return success();

  }));

  service.post('/projects/:id/datasets/:name/entities/:uuid/restore', endpoint(async ({ Projects }, { params, queryOptions }) => {

    await Projects.getById(params.id, queryOptions).then(getOrNotFound);

    const entity = getEntitySummary(1);
    entity.updatedAt = '2023-01-02T09:00:00.000Z';
    entity.currentVersion = {
      ...getVersionSummary(),
      source: {
        type: 'API',
        id: 'super-client'
      },
      data: {
        firstName: 'Jane',
        lastName: 'Roe',
        city: 'Toronto'
      },
      versionNumber: 3,
      label: 'Jane Roe',
      createdAt: '2023-01-03T09:00:00.000Z'
    };
    return entity;

  }));
};
