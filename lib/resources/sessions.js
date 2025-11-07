// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { ApiKey } = require('../model/frames');
const { generateToken, verifyPassword } = require('../util/crypto');
const Problem = require('../util/problem');
const { isBlank, isPresent, noargs } = require('../util/util');
const { getOrReject, getOrNotFound, rejectIf } = require('../util/promise');
const { success } = require('../util/http');
const { SESSION_COOKIE, createUserSession } = require('../http/sessions');
const oidc = require('../util/oidc');
const { pick } = require('ramda');

module.exports = (service, endpoint, anonymousEndpoint) => {

  if (!oidc.isEnabled()) {
    service.post('/sessions', anonymousEndpoint(({ ApiKeys, Audits, Users, Sessions }, { body, headers }) => {
      // TODO if we're planning to offer multiple authN methods, we should be looking for
      // any calls to verifyPassword(), and blocking them if that authN method is not
      // appropriate for the current user.
      //
      // It may be useful to re-use the sessions resources for other authN methods.

      const { email, password, api_key } = body;

      if (isPresent(api_key)) {
        return ApiKeys.getActor(api_key)
          .then(getOrReject(Problem.user.authenticationFailed()))
          .then((actor) =>
            createUserSession({ Audits, Sessions, Users }, headers, { actor }));
      } else if (isBlank(email) || isBlank(password))
        return Problem.user.missingParameters({ expected: [ 'email', 'password' ], got: { email, password } });

      return Users.getByEmail(email)
        .then(getOrReject(Problem.user.authenticationFailed()))
        .then((user) => verifyPassword(password, user.password)
          .then(rejectIf(
            (verified) => (verified !== true),
            noargs(Problem.user.authenticationFailed)
          ))
          .then(() => createUserSession({ Audits, Sessions, Users }, headers, user)));
    }));
  }

  service.get('/sessions/restore', endpoint((_, { auth }) =>
    auth.session
      .map(pick(['createdAt', 'expiresAt']))
      .orElse(Problem.user.notFound())));

  const logOut = (Sessions, auth, session) =>
    auth.canOrReject('session.end', session.actor)
      .then(() => Sessions.terminate(session))
      .then(() => (_, response) => {
        // revoke the cookies associated w the session, if the session was used to
        // terminate itself.
        // TODO: repetitive w above.
        if (session.token === auth.session.map((s) => s.token).orNull()) {
          response.cookie(SESSION_COOKIE, 'null', { path: '/', expires: new Date(0),
            httpOnly: true, secure: true, sameSite: 'strict' });
          response.cookie('__csrf', 'null', { expires: new Date(0),
            secure: true, sameSite: 'strict' });
        }

        return success;
      });

  service.delete('/sessions/current', endpoint(({ Sessions }, { auth }) =>
    auth.session.map(session => logOut(Sessions, auth, session))
      .orElse(Problem.user.notFound())));

  // here we always throw a 403 even if the token doesn't exist to prevent
  // information leakage.
  // TODO: but a timing attack still exists here. :(
  service.delete('/sessions/:token', endpoint(({ Sessions }, { auth, params }) =>
    Sessions.getByBearerToken(params.token)
      .then(getOrReject(Problem.user.insufficientRights()))
      .then(session => logOut(Sessions, auth, session))));

  // TODO move this elsewhere - just put it here cause i was already looking at this file
  service.post('/sessions/:projectId/create_api_key', endpoint(async ({ ApiKeys, Assignments, Projects }, { auth, params, body }) => {

    // I think the designs had API keys scoped to projects
    const project = await Projects.getById(params.projectId)
      .then(getOrNotFound);

    // Also considered generating a key and then hashing the key
    // But I needed a way to look up the API key by something
    const key = generateToken();

    // body includes "displayName", like the name of the API key
    // which gets put on the Actor that is linked to the key
    const ak = ApiKey.fromApi(body)
      .with({
        createdBy: auth.actor.map((actor) => actor.id).orNull(),
        key
      });

    // This object has api key, actor, and a session
    const created = await ApiKeys.create(ak, project);

    // The resulting api key has no ability to do anything, much like
    // an app user when you first create one and you have to go to the
    // form access page and give it access to things.
    // Here I just give project manager access to the api key.
    // To be refined in the future.
    await Assignments.grantSystem(created.actor, 'manager', project);

    // Send something back to the user that they can save and use later
    return { key };
  }));
};

