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

  service.delete('/projects/:projectId/app-users/:id', endpoint(({ Actors, FieldKeys, Projects }, { auth, params }) =>
    Projects.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.delete', project))
      .then((project) => FieldKeys.getByProjectAndActorId(project.id, params.id))
      .then(getOrNotFound)
      .then((fk) => Actors.del(fk.actor))
      .then(success)));

  // Set/unset user property values on an app user.
  // Body: { userProperties: { propName: "value" | null, ... } }
  service.patch('/projects/:projectId/app-users/:id', endpoint(async ({ UserProperties, FieldKeys, Projects }, { auth, params, body }) => {
    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);

    const fk = await FieldKeys.getByProjectAndActorId(project.id, params.id).then(getOrNotFound);

    const { userProperties } = body;
    if (userProperties != null) {
      for (const [name, value] of Object.entries(userProperties)) {
        // eslint-disable-next-line no-await-in-loop
        await UserProperties.setValueForActor(project.id, fk.actorId, name, value);
      }
    }

    const values = await UserProperties.getValuesForActor(fk.actorId);
    const userPropertiesMap = Object.fromEntries(values.map(({ name, value }) => [name, value]));
    return { ...fk.forApi(), userProperties: userPropertiesMap };
  }));

};

