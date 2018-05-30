// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Here you will find various Express middleware functions that parse requests
// and decorate useful information onto them for others to use. Some, like the
// versionParser, will reject the request if certain preconditions are not met.
//
// They are put to use in the service.js file found in this directory.

const { isBlank } = require('../util/util');
const { isTrue } = require('../util/http');
const Problem = require('../util/problem');
const { getOrReject } = require('../util/promise');
const { verifyPassword } = require('../util/crypto');


// Strips a /v# prefix off the request path and exposes on the request object
// under the apiVersion property.
const versionParser = (request, response, next) => {
  // this code will all break when we hit version 10 a century from now.
  const match = /^\/v(\d)\//.exec(request.url);
  if (match == null) return next(Problem.user.missingApiVersion());
  request.apiVersion = Number(match[1]);
  if (request.apiVersion !== 1) return next(Problem.user.unexpectedApiVersion({ got: match[1] }));
  request.url = request.url.slice(3);
  next();
};

// Used as pre-middleware, and injects the appropriate session information given the
// appropriate credentials. If the given credentials don't match a session, aborts
// with a 401. If no credentials are given, injects an empty session.
// TODO: probably a better home for this.
// TODO: repetitive, but detangling it doesn't make it clearer.
const sessionParser = ({ Session, User, Auth }) => (request, response, next) => {
  const authHeader = request.get('Authorization');
  if (!isBlank(authHeader) && authHeader.startsWith('Bearer ')) {
    // Standard Bearer token auth.
    if ((request.auth != null) && request.auth.isAuthenticated()) return next(Problem.user.authenticationFailed());

    Session.getByBearerToken(authHeader.slice(7)).point()
      .then((session) => {
        if (!session.isDefined()) return next(Problem.user.authenticationFailed());

        request.auth = new Auth({ _session: session });
        next();
      });
  } else if (!isBlank(authHeader) && authHeader.startsWith('Basic ')) {
    // Allow Basic auth over HTTPS only.
    if ((request.auth != null) && request.auth.isAuthenticated()) return next(Problem.user.authenticationFailed());

    // fail the request unless we are under HTTPS.
    // this logic does mean that if we are not under nginx it is possible to fool the server.
    // but it is the user's prerogative to undertake this bypass, so their security is in their hands.
    if ((request.protocol !== 'https') && (request.get('x-forwarded-proto') !== 'https'))
      return next(Problem.user.httpsOnly());

    // we have to use a regex rather than .split(':') in case the password contains :s.
    const plainCredentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const match = /^([^:]+):(.+)$/.exec(plainCredentials);
    if (match == null) return next(Problem.user.authenticationFailed());
    const [ , email, password ] = match;

    // actually do our verification.
    // TODO: email existence timing attack on whether bcrypt runs or not.
    User.getByEmail(email).point()
      .then(getOrReject(Problem.user.authenticationFailed()))
      .then((user) => verifyPassword(password, user.password).point()
        .then((verified) => {
          if (verified === true) {
            request.auth = new Auth({ _actor: user.actor });
            next();
          } else {
            next(Problem.user.authenticationFailed());
          }
        }))
      .catch(next);
  } else {
    request.auth = new Auth();
    next();
  }
};

// Like sessionParser, but rather than parse OAuth2-style Bearer tokens from the
// header, picks up field keys from the url. Splices in /after/ the versionParser;
// does not expect or understand the version prefix.
//
// If authentication is already provided via Bearer token, we reject with 401.
//
// In addition to rejecting with 401 if the token is invalid, we also reject if
// the token does not belong to a field key, as only field keys may be used in
// this manner. (TODO: we should not explain in-situ for security reasons, but we
// should explain /somewhere/.)
const fieldKeyParser = ({ Session, Auth }) => (request, response, next) => {
  const match = /^\/key\/([a-z0-9!$]{64})\//i.exec(request.url);
  if (match == null) return next();
  if ((request.auth != null) && (request.auth.isAuthenticated())) return next(Problem.user.authenticationFailed());

  Session.getByBearerToken(match[1]).point()
    .then(getOrReject(Problem.user.authenticationFailed()))
    .then((session) => {
      if (session.actor.type !== 'field_key') return next(Problem.user.authenticationFailed());

      request.auth = new Auth({ _session: session });
      request.url = request.url.slice('/key/'.length + match[1].length);
      next();
    })
    .catch(next);
};

// simply determines if we have been fed a true-ish value for X-Extended-Metadata.
// decorates onto request at request.extended.
const headerOptionsParser = (request, response, next) => {
  const extendedMeta = request.get('X-Extended-Metadata');
  if (isTrue(extendedMeta)) request.extended = true;
  next();
};


module.exports = { versionParser, sessionParser, fieldKeyParser, headerOptionsParser };

