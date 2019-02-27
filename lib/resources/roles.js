// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { getOrNotFound } = require('../util/promise');

module.exports = (service, endpoint) => {

  service.get('/roles', endpoint(({ Role }, { auth }) =>
    auth.canOrReject('role.list', Role.species()).then(() => Role.getAll())));

  service.get('/roles/:id', endpoint(({ Role }, { auth, params }) =>
    auth.canOrReject('role.read', Role.species())
      .then(() => (/[a-z]/.test(params.id) ? Role.getBySystemName : Role.getById)(params.id)
        .then(getOrNotFound))));

};

