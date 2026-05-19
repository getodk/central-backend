// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const config = require('config');

// TODO use req.protocol?
const HTTPS_ENABLED = config.get('default.env.domain').startsWith('https://');

// We want the __Host prefix in production, but it's not possible when developing using http://
// See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#__host-
const SESSION_COOKIE = HTTPS_ENABLED ? '__Host-session' : 'session';

const createUserSession = ({ Audits, Sessions, Users }, headers, user) => Promise.all([
  Sessions.create(user.actor),
  // Logging here rather than defining Sessions.create.audit, because
  // Sessions.create.audit would require auth. Logging here also makes
  // it easy to access `headers`.
  Audits.log(user.actor, 'user.session.create', user.actor, {
    userAgent: headers['user-agent']
  }),
  Users.updateLastLoginAt(user)
])
  .then(([ session ]) => (_, response) => {
    response.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      path: '/',
      expires: session.expiresAt,
      secure: HTTPS_ENABLED,
      sameSite: 'Strict',
    });

    response.cookie('__csrf', session.csrf, {
      expires: session.expiresAt,
      secure: HTTPS_ENABLED,
      sameSite: 'Strict',
    });

    return session;
  });

module.exports = { SESSION_COOKIE, createUserSession };
