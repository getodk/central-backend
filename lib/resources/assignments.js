// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { QueryOptions } = require('../util/db');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const Problem = require('../util/problem');


const getRoleByParam = (Role, param) =>
  (/[a-z]/.test(param) ? Role.getBySystemName : Role.getById)(param);

module.exports = (service, endpoint) => {

  ////////////////////////////////////////////////////////////////////////////////
  // SITEWIDE ASSIGNMENTS

  service.get('/assignments', endpoint(({ Assignment }, { auth, queryOptions }) =>
    auth.canOrReject('assignment.list', Assignment.species())
      .then(() => Assignment.getByActeeId('*', queryOptions))));

  service.get('/assignments/:roleId', endpoint(({ Assignment, Role }, { auth, params }) =>
    auth.canOrReject('assignment.list', Assignment.species())
      .then(() => getRoleByParam(Role, params.roleId))
      .then(getOrNotFound)
      .then((role) => Assignment.getByActeeAndRoleId('*', role.id, QueryOptions.extended))
      .then((assignments) => assignments.map((assignment) => assignment.actor))));

  service.post('/assignments/:roleId/:actorId', endpoint(({ Actor, Assignment, Audit, Role }, { auth, params }) =>
    Promise.all([
      getRoleByParam(Role, params.roleId).then(getOrNotFound),
      Actor.getById(params.actorId).then(getOrNotFound)
    ]).then(([ role, actor ]) =>
      auth.canOrReject('assignment.create', Assignment.species()) // sitewide assignment rights
        .then(() => Promise.all([
          actor.assignRole(role, '*'),
          Audit.log(auth.actor(), 'assignment.create', actor, { roleId: role.id, grantedActeeId: '*' })
        ]))
        .then(success))));

  service.delete('/assignments/:roleId/:actorId', endpoint(({ Actor, Assignment, Audit, Role }, { auth, params }) =>
    Promise.all([
      getRoleByParam(Role, params.roleId).then(getOrNotFound),
      Actor.getById(params.actorId).then(getOrNotFound)
    ]).then(([ role, actor ]) =>
      auth.canOrReject('assignment.delete', Assignment.species()) // sitewide assignment rights
        .then(() => Promise.all([
          actor.unassignRole(role, '*'),
          Audit.log(auth.actor(), 'assignment.delete', actor, { roleId: role.id, revokedActeeId: '*' })
        ]))
        .then(([ result ]) => ((result === true) ? success() : Problem.user.notFound())))));


  ////////////////////////////////////////////////////////////////////////////////
  // PROJECT ASSIGNMENTS
  // TODO: should these be elsewhere?

  service.get('/projects/:id/assignments', endpoint(({ Assignment, Project }, { auth, params, queryOptions }) =>
    Project.getById(params.id)
      .then(getOrNotFound)
      .then((project) => auth.canOrReject('assignment.list', project)
        .then(() => Assignment.getByActeeId(project.acteeId, queryOptions)))));

  service.get('/projects/:id/assignments/:roleId', endpoint(({ Assignment, Project, Role }, { auth, params }) =>
    Promise.all([
      Project.getById(params.id).then(getOrNotFound),
      getRoleByParam(Role, params.roleId).then(getOrNotFound)
    ])
      .then(([ project, role ]) => auth.canOrReject('assignment.list', project)
        .then(() => Assignment.getByActeeAndRoleId(project.acteeId, role.id, QueryOptions.extended))
        .then((assignments) => assignments.map((assignment) => assignment.actor)))));

  service.post('/projects/:id/assignments/:roleId/:actorId', endpoint(({ Actor, Audit, Project, Role }, { auth, params }) =>
    Promise.all([
      Project.getById(params.id).then(getOrNotFound),
      getRoleByParam(Role, params.roleId).then(getOrNotFound),
      Actor.getById(params.actorId).then(getOrNotFound)
    ])
      .then(([ project, role, actor ]) => auth.canOrReject('assignment.create', project)
        .then(() => Promise.all([
          actor.assignRole(role, project),
          Audit.log(auth.actor(), 'assignment.create', actor, { roleId: role.id, grantedActeeId: project.acteeId })
        ]))
        .then(success))));

  service.delete('/projects/:id/assignments/:roleId/:actorId', endpoint(({ Actor, Audit, Project, Role }, { auth, params }) =>
    Promise.all([
      Project.getById(params.id).then(getOrNotFound),
      getRoleByParam(Role, params.roleId).then(getOrNotFound),
      Actor.getById(params.actorId).then(getOrNotFound)
    ])
      .then(([ project, role, actor ]) => auth.canOrReject('assignment.delete', project)
        .then(() => Promise.all([
          actor.unassignRole(role, project),
          Audit.log(auth.actor(), 'assignment.delete', actor, { roleId: role.id, revokedActeeId: project.acteeId })
        ]))
        .then(([ result ]) => ((result === true) ? success() : Problem.user.notFound())))));

};

