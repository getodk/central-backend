// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { QueryOptions } = require('../util/db');
const { getOrNotFound, resolve, reject } = require('../util/promise');
const { success } = require('../util/http');
const Problem = require('../util/problem');


const getRoleByParam = (Roles, param) =>
  (/[a-z]/.test(param) ? Roles.getBySystemName : Roles.getById)(param);

module.exports = (service, endpoint) => {

  ////////////////////////////////////////////////////////////////////////////////
  // CUSTOM READ-ONLY FORMS ASSIGNMENTS API
  // we provide a read-only assignments api to provide a complete summary of
  // all users with a given role across all forms in a project in a single call.

  service.get('/projects/:id/assignments/forms', endpoint(({ Assignments, Projects }, { auth, params, queryOptions }) =>
    Projects.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('assignment.list', project))
      .then((project) => Assignments.getForFormsByProjectId(project.id, queryOptions))));

  service.get('/projects/:id/assignments/forms/:roleId', endpoint(({ Assignments, Projects, Roles }, { auth, params, queryOptions }) =>
    Promise.all([
      Projects.getById(params.id)
        .then(getOrNotFound)
        .then((project) => auth.canOrReject('assignment.list', project)),
      getRoleByParam(Roles, params.roleId).then(getOrNotFound)
    ])
      .then(([ project, role ]) => Assignments.getForFormsByProjectAndRoleId(project.id, role.id, queryOptions))));


  ////////////////////////////////////////////////////////////////////////////////
  // GENERIC ASSIGNMENTS RESOURCES
  // because assignable actees have a standard interface, we can define these
  // actions generically. they are called below to define concrete endpoints.

  const assignmentsResource = (base, getInstance) => {
    service.get(`${base}/assignments`, endpoint((container, { auth, params, queryOptions }) =>
      getInstance(container, params)
        .then((instance) => auth.canOrReject('assignment.list', instance)
          .then(() => container.Assignments.getByActeeId(instance.acteeId, queryOptions)))));

    service.get(`${base}/assignments/:roleId`, endpoint((container, { auth, params }) =>
      Promise.all([
        getInstance(container, params),
        getRoleByParam(container.Roles, params.roleId).then(getOrNotFound)
      ])
        .then(([ instance, role ]) => auth.canOrReject('assignment.list', instance)
          .then(() => container.Assignments.getByActeeAndRoleId(instance.acteeId, role.id, QueryOptions.extended))
          .then((assignments) => assignments.map((assignment) => assignment.actor)))));

    service.post(`${base}/assignments/:roleId/:actorId`, endpoint((container, { auth, params }) =>
      Promise.all([
        getInstance(container, params),
        getRoleByParam(container.Roles, params.roleId).then(getOrNotFound),
        container.Actors.getById(params.actorId).then(getOrNotFound)
      ])
        .then(([ instance, role, actor ]) => Promise.all([
          auth.canOrReject('assignment.create', instance),
          auth.canAssignRole(role, instance)
            .then((can) => can || reject(Problem.user.insufficientRights()))
        ])
          .then(() => container.Assignments.grant(actor, role, instance))
          .then(success))));

    service.delete(`${base}/assignments/:roleId/:actorId`, endpoint((container, { auth, params }) =>
      Promise.all([
        getInstance(container, params),
        getRoleByParam(container.Roles, params.roleId).then(getOrNotFound),
        container.Actors.getById(params.actorId).then(getOrNotFound)
      ])
        .then(([ instance, role, actor ]) => auth.canOrReject('assignment.delete', instance)
          .then(() => container.Assignments.revoke(actor, role, instance))
          .then((deleted) => (deleted ? success : reject(Problem.user.notFound()))))));
  };

  ////////////////////////////////////////
  // RESOURCE ASSIGNMENTS IMPL

  assignmentsResource('', () => resolve({ acteeId: '*' }));

  assignmentsResource('/projects/:id', ({ Projects }, params) =>
    Projects.getById(params.id).then(getOrNotFound));

  assignmentsResource('/projects/:projectId/forms/:id', ({ Forms }, params) =>
    Forms.getByProjectAndXmlFormId(params.projectId, params.id).then(getOrNotFound));

};

