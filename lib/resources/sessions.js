// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('../util/problem');
const { isBlank } = require('../util/util');
const { getOrReject } = require('../util/promise');
const { success } = require('../util/http');


module.exports = (service, endpoint) => {

  service.post('/sessions', endpoint(({ User, Session, crypto }, { body }) => {
    const { email, password } = body;

    if (isBlank(email) || isBlank(password))
      return Problem.user.missingParameters({ expected: [ 'email', 'password' ], got: { email, password } });

    return User.getByEmail(email)
      .then(getOrReject(Problem.user.authenticationFailed()))
      .then((user) => crypto.verifyPassword(password, user.password)
        .then((verified) => ((verified !== true)
          ? Problem.user.authenticationFailed()
          : Session.fromActor(user.actor).create()
            .then((session) => (_, response) => {
              response.cookie('__Host-session', session.token, { path: '/', expires: session.expiresAt,
                httpOnly: true, secure: true, sameSite: 'strict' });
              response.cookie('__csrf', session.csrf, { expires: session.expiresAt,
                secure: true, sameSite: 'strict' });

              return session;
            }))));
  }));

  service.get('/sessions/restore', endpoint((_, { auth }) =>
    auth.session().orElse(Problem.user.notFound())));

  // here we always throw a 403 even if the token doesn't exist to prevent
  // information leakage.
  // TODO: but a timing attack still exists here. :(
  service.delete('/sessions/:token', endpoint(({ Session }, { auth, params }) =>
    Session.getByBearerToken(params.token)
      .then(getOrReject(Problem.user.insufficientRights()))
      .then((token) => auth.canOrReject('session.end', token.actor)
        .then(() => token.delete())
        .then(() => (_, response) => {
          // TODO: repetitive w above.
          response.cookie('__Host-session', 'null', { path: '/', expires: new Date(0),
            httpOnly: true, secure: true, sameSite: 'strict' });
          return success;
        }))));

};

