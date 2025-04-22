// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { verifyPassword, isValidToken } = require('../util/crypto');
const { isBlank, isPresent, noop, omit } = require('../util/util');
const { isTrue, urlDecode } = require('../util/http');
const oidc = require('../util/oidc');
const Problem = require('../util/problem');
const { QueryOptions } = require('../util/db');
const { reject, getOrReject } = require('../util/promise');
const { SESSION_COOKIE } = require('./sessions');

// injects an empty/anonymous auth object into the request context.
const emptyAuthInjector = ({ Auth }, context) => context.with({ auth: Auth.by(null) });

// if one of (Bearer|Basic|Cookie) credentials are provided in the correct conditions
// then authHandler injects the appropriate auth information to the context
// given the appropriate credentials. if credentials are given but don't match a
// session or user, aborts the request with a 401.
//
// otherwise, nothing is done. n.b. this means you must use the emptyAuthInjector
// in conjunction with this function!
//
// TODO?: repetitive, but deduping it makes it even harder to understand.
const authHandler = ({ Sessions, Users, Auth }, context) => {
  const authBySessionToken = (token, onFailure = noop) => Sessions.getByBearerToken(token)
    .then((session) => {
      if (session.isEmpty()) return onFailure();
      return context.with({ auth: Auth.by(session.get()) });
    });

  const authHeader = context.headers.authorization;

  // If a field key is provided, we use it first and foremost. We used to go the
  // other way around with this, but especially with Public Links it has become
  // more sensible to resolve collisions by prioritizing field keys.
  if (context.fieldKey.isDefined()) {
    // Picks up field keys from the url.
    // We always reject with 403 for field keys rather than 401 as we do with the
    // other auth mechanisms. In an ideal world, we would do 401 here as well. But
    // a lot of the ecosystem tools will prompt the user for credentials if you do
    // this, even if you don't issue an auth challenge. So we 403 as a close-enough.
    //
    // In addition to rejecting with 403 if the token is invalid, we also reject if
    // the token does not belong to a field key, as only field keys may be used in
    // this manner. (TODO: we should not explain in-situ for security reasons, but we
    // should explain /somewhere/.)

    const key = context.fieldKey.get();
    if (!isValidToken(key)) return reject(Problem.user.authenticationFailed());

    return Sessions.getByBearerToken(key)
      .then(getOrReject(Problem.user.insufficientRights()))
      .then((session) => {
        if ((session.actor.type !== 'field_key') && (session.actor.type !== 'public_link'))
          return reject(Problem.user.insufficientRights());
        return context.with({ auth: Auth.by(session) });
      });

  // Standard Bearer token auth:
  } else if (isPresent(authHeader) && authHeader.startsWith('Bearer ')) {
    // auth by the bearer token we found:
    return authBySessionToken(authHeader.substring(7), () => reject(Problem.user.authenticationFailed()));

  // Basic Auth, which is allowed under certain circumstances:
  } else if (isPresent(authHeader) && authHeader.startsWith('Basic ')) {
    if (oidc.isEnabled()) return reject(Problem.user.basicAuthNotSupportedWhenOidcEnabled());

    // fail the request unless we are under HTTPS.
    // this logic does mean that if we are not under nginx it is possible to fool the server.
    // but it is the user's prerogative to undertake this bypass, so their security is in their hands.
    if ((context.protocol !== 'https') && (context.headers['x-forwarded-proto'] !== 'https'))
      return reject(Problem.user.httpsOnly());

    // we have to use a regex rather than .split(':') in case the password contains :s.
    const plainCredentials = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
    const match = /^([^:]+):(.+)$/.exec(plainCredentials);
    if (match == null) return reject(Problem.user.authenticationFailed());
    const [ , email, password ] = match;

    // actually do our verification.
    // TODO: email existence timing attack on whether bcrypt runs or not.
    return Users.getByEmail(email)
      .then(getOrReject(Problem.user.authenticationFailed()))
      .then((user) => verifyPassword(password, user.password)
        .then((verified) => {
          if (verified === true)
            return context.with({ auth: Auth.by(user.actor) });

          return reject(Problem.user.authenticationFailed());
        }));

  // Authorization header supplied, but in an unrecognised format:
  } else if (isPresent(authHeader)) {
    return reject(Problem.user.authenticationFailed());

  // Cookie Auth, which is more relaxed about not doing anything on failures.
  // but if the method is anything but GET we will need to check the CSRF token.
  } else if (context.headers.cookie != null) {
    // fail the request unless we are under HTTPS.
    if ((context.protocol !== 'https') && (context.headers['x-forwarded-proto'] !== 'https'))
      return;

    // otherwise get the cookie contents.
    const token = context.cookies[SESSION_COOKIE];
    if (token == null)
      return;
    // actually try to authenticate with it. no Problem on failure.
    const maybeSession = authBySessionToken(token);

    // Following code is for the CSRF protection.
    // Rules:
    // 1 - If it is a non-POST request then we allow it.
    // 2 - If it is a POST request then we require it to have either a custom header
    //     `x-requested-with` with the value of `XMLHttpRequest` or the body should contain `__csrf`
    //     token
    if (context.method !== 'POST') return maybeSession;

    if (context.headers['x-requested-with'] === 'XMLHttpRequest') {
      return maybeSession;
    }

    // if POST run authentication as usual but we'll have to check CSRF afterwards.
    return maybeSession.then((cxt) => { // we have to use cxt rather than context for the linter
      // if authentication failed anyway, just do nothing.
      if ((cxt == null) || cxt.auth.session.isEmpty()) return;

      const csrf = urlDecode(cxt.body.__csrf);
      if (csrf.isEmpty() || isBlank(csrf.get()) || (cxt.auth.session.get().csrf !== csrf.get())) {
        return reject(Problem.user.authenticationFailed());
      }

      // delete the token off the body so it doesn't mess with downstream
      // payload expectations.
      return cxt.with({ body: omit([ '__csrf' ], cxt.body) });
    });
  }
};

// translates some simple things into specific context parameters.
const queryOptionsHandler = (_, context) => {
  const { headers, query } = context;
  const options = {};

  // set extended metadata:
  const extendedMeta = headers['x-extended-metadata'];
  if (isTrue(extendedMeta)) options.extended = true;

  // parse in paging parameters:
  if (query.offset != null) options.offset = parseInt(query.offset, 10);
  if (Number.isNaN(options.offset))
    return reject(Problem.user.invalidDataTypeOfParameter({ field: 'offset', expected: 'integer' }));
  if (query.limit != null) options.limit = parseInt(query.limit, 10);
  if (Number.isNaN(options.limit))
    return reject(Problem.user.invalidDataTypeOfParameter({ field: 'limit', expected: 'integer' }));

  // add an inert reference to all passed params:
  options.argData = query;

  return context.with({ queryOptions: new QueryOptions(options), transitoryData: new Map() });
};

// User Agent in HTTP is optional, if not provided then it is `undefined`.
// `undefined` causes Slonik to fail, we are setting it to `null` here so that
// we don't have check its existence in multiple places.
const userAgentHandler = (_, context) => {
  const userAgent = context.headers['user-agent'] ?? null;
  return context.with({ userAgent });
};

module.exports = { emptyAuthInjector, authHandler, queryOptionsHandler, userAgentHandler };

