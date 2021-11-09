// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('../util/problem');
const { isBlank, noargs } = require('../util/util');
const { getOrReject, rejectIf } = require('../util/promise');
const { success } = require('../util/http');


module.exports = (service, endpoint) => {

  service.post('/sessions', endpoint(({ Audits, Users, Sessions, bcrypt }, { body, headers }) => {
    const { email, password } = body;

    if (isBlank(email) || isBlank(password))
      return Problem.user.missingParameters({ expected: [ 'email', 'password' ], got: { email, password } });

    return Users.getByEmail(email)
      .then(getOrReject(Problem.user.authenticationFailed()))
      .then((user) => bcrypt.verify(password, user.password)
        .then(rejectIf(
          (verified) => (verified !== true),
          noargs(Problem.user.authenticationFailed)
        ))
        .then(() => Promise.all([
          Sessions.create(user.actor),
          // Logging here rather than defining Sessions.create.audit, because
          // Sessions.create.audit would require auth. Logging here also makes
          // it easy to access `headers`.
          Audits.log(user.actor, 'user.session.create', user.actor, {
            userAgent: headers['user-agent']
          })
        ]))
        .then(([ session ]) => (_, response) => {
          response.cookie('__Host-session', session.token, { path: '/', expires: session.expiresAt,
            httpOnly: true, secure: true, sameSite: 'strict' });
          response.cookie('__csrf', session.csrf, { expires: session.expiresAt,
            secure: true, sameSite: 'strict' });

          return session;
        }));
  }));

  service.get('/sessions/restore', endpoint((_, { auth }) =>
    auth.session.orElse(Problem.user.notFound())));

  // here we always throw a 403 even if the token doesn't exist to prevent
  // information leakage.
  // TODO: but a timing attack still exists here. :(
  service.delete('/sessions/:token', endpoint(({ Sessions }, { auth, params }) =>
    Sessions.getByBearerToken(params.token)
      .then(getOrReject(Problem.user.insufficientRights()))
      .then((session) => auth.canOrReject('session.end', session.actor)
        .then(() => Sessions.terminate(session))
        .then(() => (_, response) => {
          // revoke the cookie associated w the session, if the session was used to
          // terminate itself.
          // TODO: repetitive w above.
          if (session.token === auth.session.map((s) => s.token).orNull())
            response.cookie('__Host-session', 'null', { path: '/', expires: new Date(0),
              httpOnly: true, secure: true, sameSite: 'strict' });

          return success;
        }))));

};

