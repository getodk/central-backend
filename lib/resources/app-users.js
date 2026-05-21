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
const { extractActorProperties } = require('../data/actor-properties');

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
      .then((project) => auth.canOrReject('field_key.list', project))
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
    await auth.canOrReject('field_key.update', project);

    const fk = await FieldKeys.getByProjectAndActorId(project.id, params.id).then(getOrNotFound);

    const properties = body.properties != null ? extractActorProperties(body.properties) : null;

    if (properties != null)
      await ActorProperties.setValuesForActor(project.id, fk.actorId, properties);

    return FieldKeys.getByProjectAndActorId(project.id, params.id, QueryOptions.extended).then(getOrNotFound);
  }));
};

