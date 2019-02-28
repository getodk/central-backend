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

  service.get('/assignments', endpoint(({ Assignment }, { auth, queryOptions }) =>
    auth.canOrReject('assignment.list', Assignment.species())
      .then(() => Assignment.getByActeeId('*', queryOptions))));

  service.get('/assignments/:roleId', endpoint(({ Assignment, Role }, { auth, params }) =>
    auth.canOrReject('assignment.list', Assignment.species())
      .then(() => getRoleByParam(Role, params.roleId))
      .then(getOrNotFound)
      .then((role) => Assignment.getByActeeAndRoleId('*', role.id, QueryOptions.extended))
      .then((assignments) => assignments.map((assignment) => assignment.actor))));

  service.post('/assignments/:roleId/:actorId', endpoint(({ Actor, Assignment, Role }, { auth, params }) =>
    Promise.all([
      getRoleByParam(Role, params.roleId).then(getOrNotFound),
      Actor.getById(params.actorId).then(getOrNotFound)
    ]).then(([ role, actor ]) =>
      auth.canOrReject('assignment.create', Assignment.species()) // sitewide assignment rights
        .then(() => actor.assignRole(role, '*'))
        .then(success))));

  service.delete('/assignments/:roleId/:actorId', endpoint(({ Actor, Assignment, Role }, { auth, params }) =>
    Promise.all([
      getRoleByParam(Role, params.roleId).then(getOrNotFound),
      Actor.getById(params.actorId).then(getOrNotFound)
    ]).then(([ role, actor ]) =>
      auth.canOrReject('assignment.delete', Assignment.species()) // sitewide assignment rights
        .then(() => actor.unassignRole(role, '*'))
        .then((result) => (result === true) ? success() : Problem.user.notFound()))));

};

