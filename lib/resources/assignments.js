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

module.exports = (service, endpoint) => {

  service.get('/assignments', endpoint(({ Assignment }, { auth, queryOptions }) =>
    auth.canOrReject('assignment.list', Assignment.species())
      .then(() => Assignment.getAll(queryOptions))));

  service.get('/assignments/:roleId', endpoint(({ Assignment, Role }, { auth, params }) =>
    auth.canOrReject('assignment.list', Assignment.species())
      .then(() => /[a-z]/.test(params.roleId)
        ? Role.getBySystemName(params.roleId).then(getOrNotFound).then((role) => role.id)
        : params.roleId)
      .then((roleId) => Assignment.getByRoleId(roleId, QueryOptions.extended))
      .then((assignments) => assignments.map((assignment) => assignment.actor))));

};

