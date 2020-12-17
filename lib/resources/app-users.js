// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound, ignoringResult } = require('../util/promise');
const { success } = require('../util/http');

module.exports = (service, endpoint) => {

  service.get('/projects/:projectId/app-users', endpoint(({ Project }, { auth, params, queryOptions }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.list', project)
        .then(() => project.getAllFieldKeys(queryOptions)))));

  service.post('/projects/:projectId/app-users', endpoint(({ Audit, FieldKey, Project }, { auth, body, params }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.create', project)
        .then(() => FieldKey.fromApi(body).with({
          projectId: project.id,
          createdBy: auth.actor().map((actor) => actor.id).orNull(),
          actor: { type: 'field_key' }
        }).create()
          .then(ignoringResult((fk) => Audit.log(auth.actor(), 'field_key.create', fk.actor)))))));

  service.delete('/projects/:projectId/app-users/:id', endpoint(({ Assignment, Project }, { auth, params }) =>
    Project.getById(params.projectId)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('field_key.delete', project)
        .then(() => project.getFieldKeyByActorId(params.id))
        .then(getOrNotFound)
        .then((fk) => Promise.all([
          fk.delete(),
          Assignment.deleteByActor(fk.actor)
        ]))
        .then(success))));

};

