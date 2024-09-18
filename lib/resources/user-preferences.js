// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');

module.exports = (service, endpoint) => {

  ////////////////////////////////////////////////////////////////////////////////
  // User preferences (UI settings)
  // There are no endpoints to retrieve preferences here. Rather, the collection
  // of preferences are served out through the extended version of /users/current.

  //////////////
  // Per-project
  service.put('/user-preferences/project/:projectId/:propertyName', endpoint(({ UserPreferences }, { body, auth, params }) => {
    // Expects a body of {"propertyValue": X}, where X will go into the propertyValue column.
    if (body.propertyValue === undefined) return Problem.user.propertyNotFound({ property: 'propertyValue' });
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.writeProjectProperty(auth.actor.value.id, params.projectId, params.propertyName, body.propertyValue)
      .then(success);
  }));

  service.delete('/user-preferences/project/:projectId/:propertyName', endpoint(({ UserPreferences }, { auth, params }) => {
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.removeProjectProperty(auth.actor.value.id, params.projectId, params.propertyName)
      .then(getOrNotFound);
  }));

  ///////////
  // Sitewide
  service.delete('/user-preferences/site/:propertyName', endpoint(({ UserPreferences }, { auth, params }) => {
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.removeSiteProperty(auth.actor.value.id, params.propertyName)
      .then(getOrNotFound);
  }));

  service.put('/user-preferences/site/:propertyName', endpoint(({ UserPreferences }, { body, auth, params }) => {
    // Expects a body of {"propertyValue": X}, where X will go into the propertyValue column.
    if (body.propertyValue === undefined) return Problem.user.propertyNotFound({ property: 'propertyValue' });
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.writeSiteProperty(auth.actor.value.id, params.propertyName, body.propertyValue)
      .then(success);
  }));

};