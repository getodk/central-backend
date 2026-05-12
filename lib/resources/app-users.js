// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { FieldKey } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const { QueryOptions } = require('../util/db');
const Problem = require('../util/problem');

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/app-users', endpoint(({ FieldKeys, Projects }, { auth, params, queryOptions }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.list', project))
      .then((project) => FieldKeys.getAllForProject(project, queryOptions))));

  service.post('/projects/:projectId/app-users', endpoint(({ FieldKeys, Projects }, { auth, body, params }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.create', project))
      .then((project) => {
        const fk = FieldKey.fromApi(body)
          .with({ createdBy: auth.actor.map((actor) => actor.id).orNull() });
        return FieldKeys.create(fk, project);
      })));

  service.get('/projects/:projectId/app-users/:id', endpoint(({ FieldKeys, Projects }, { auth, params, queryOptions }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.delete', project))
      .then((project) => FieldKeys.getByProjectAndActorId(project.id, params.id, queryOptions))
      .then(getOrNotFound)));

  service.delete('/projects/:projectId/app-users/:id', endpoint(({ Actors, FieldKeys, Projects }, { auth, params }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.delete', project))
      .then((project) => FieldKeys.getByProjectAndActorId(project.id, params.id))
      .then(getOrNotFound)
      .then((fk) => Actors.del(fk.actor))
      .then(success)));

  // Set/unset actor property values on an app user.
  // Body: { properties: { propName: "value" | null, ... } }
  service.patch('/projects/:projectId/app-users/:id', endpoint(async ({ ActorProperties, FieldKeys, Projects }, { auth, params, body }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);

    const fk = await FieldKeys.getByProjectAndActorId(project.id, params.id).then(getOrNotFound);

    const { properties } = body;

    // Validate properties: reject non-objects, reject non-strings, trim whitespace
    // Interpret empty string as null value
    if (properties != null) {
      if (typeof properties !== 'object' || Array.isArray(properties))
        throw Problem.user.unexpectedValue({ field: 'properties', value: properties, reason: 'Must be an object.' });
      for (const [name, value] of Object.entries(properties)) {
        if (value !== null && typeof value !== 'string')
          throw Problem.user.unexpectedValue({ field: name, value, reason: 'Property values must be strings or null.' });
        const sanitized = value?.trim() ?? null;
        // eslint-disable-next-line no-await-in-loop
        await ActorProperties.setValueForActor(project.id, fk.actorId, name, sanitized === '' ? null : sanitized);
      }
    }

    return FieldKeys.getByProjectAndActorId(project.id, params.id, QueryOptions.extended).then(getOrNotFound);
  }));
};

