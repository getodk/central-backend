// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { always } = require('ramda');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');

module.exports = (service, endpoint) => {

  //////////////////////////////////////////////////////////////////////////////
  // User preferences (UI settings)

  //////////////////////////////////////////////////////////////////////////////
  // Endpoint to get all of a user's preferences.
  // For completeness and ease of debugging; as these preferences are normally
  // pulled in by the frontend through the extended version of /users/current.
  service.get('/user-preferences', endpoint.simple(({ UserPreferences }, { auth }) => {
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.getForUser(auth.actor.value.id)
      .then(res => ({ headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: res.preferences }));
  }));

  //////////////
  // Per-project
  service.put('/user-preferences/project/:projectId/:propertyName', endpoint.simple(({ UserPreferences }, { body, auth, params }) => {
    // Expects a body of {"propertyValue": X}, where X will go into the propertyValue column.
    if (body.propertyValue === undefined) return Problem.user.propertyNotFound({ property: 'propertyValue' });
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.writeProjectProperty(auth.actor.value.id, params.projectId, params.propertyName, body.propertyValue)
      .then(always({ status: 201 }));
  }));

  service.delete('/user-preferences/project/:projectId/:propertyName', endpoint.simple(({ UserPreferences }, { auth, params }) => {
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.removeProjectProperty(auth.actor.value.id, params.projectId, params.propertyName)
      .then(getOrNotFound)
      .then(always({ status: 204 }));
  }));

  ///////////
  // Sitewide
  service.delete('/user-preferences/site/:propertyName', endpoint.simple(({ UserPreferences }, { auth, params }) => {
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.removeSiteProperty(auth.actor.value.id, params.propertyName)
      .then(getOrNotFound)
      .then(always({ status: 204 }));
  }));

  service.put('/user-preferences/site/:propertyName', endpoint.simple(({ UserPreferences }, { body, auth, params }) => {
    // Expects a body of {"propertyValue": X}, where X will go into the propertyValue column.
    if (body.propertyValue === undefined) return Problem.user.propertyNotFound({ property: 'propertyValue' });
    if (auth.actor.value === undefined) return Problem.user.insufficientRights();
    return UserPreferences.writeSiteProperty(auth.actor.value.id, params.propertyName, body.propertyValue)
      .then(always({ status: 201 }));
  }));

};
