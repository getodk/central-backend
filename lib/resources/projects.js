// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');

module.exports = (service, endpoint) => {
  service.get('/projects', endpoint(({ Actee, Project }, { auth, queryOptions }) =>
    auth.canOrReject('project.list', Actee.species('project'))
      .then(() => Project.getAll(queryOptions))));

  service.post('/projects', endpoint(({ Actee, Audit, Project }, { auth, body }) =>
    auth.canOrReject('project.create', Actee.species('project'))
      .then(() => Project.fromApi(body).create())
      .then((project) => Audit.log(auth.actor(), 'project.create', project)
        .then(() => project))));

  service.get('/projects/:id', endpoint(({ Project }, { auth, params, queryOptions }) =>
    Project.getById(params.id, queryOptions)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.read', project)
        .then(() => project))));

  service.patch('/projects/:id', endpoint(({ Audit, Project }, { auth, body, params }) =>
    Project.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.update', project)
        .then(() => {
          const updatedFields = Project.fromApi(body);
          return Promise.all([
            project.with(updatedFields).update(),
            Audit.log(auth.actor(), 'project.update', project, updatedFields)
          ]);
        })
        .then(([ updatedProject ]) => updatedProject))));

  service.delete('/projects/:id', endpoint(({ Audit, Project }, { auth, params }) =>
    Project.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('project.delete', project)
        .then(() => Promise.all([
          project.delete(),
          Audit.log(auth.actor(), 'project.delete', project)
        ]))
        .then(success))));
};

