// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('../util/problem');
const { success } = require('../util/http');

module.exports = (service, endpoint) => {

  //////////////////////////////////////////////////////////////////////////////
  // User preferences (UI settings)

  service.get('/user-preferences/current', endpoint(({ UserPreferences }, { auth }) =>
    auth.actor.map((actor) =>
      UserPreferences.getForUser(actor.id)
        .then(res => res.value?.body || {})
    ).orElse(Problem.user.notFound())
  ));

  service.post('/user-preferences/current', endpoint(({ UserPreferences }, { body, auth }) =>
    auth.actor.map((actor) =>
      UserPreferences.setForUser(actor.id, body)
        .then(success)
    ).orElse(Problem.user.notFound())
  ));

  service.patch('/user-preferences/current', endpoint(({ UserPreferences }, { body, auth }) =>
    auth.actor.map((actor) =>
      UserPreferences.patchForUser(actor.id, body)
        .then(success)
    )
  ));
};
