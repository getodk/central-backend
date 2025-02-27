// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Allow declaring util functions at the end of the file:
/* eslint-disable no-use-before-define */

// OpenID Connect auth handling using Authorization Code Flow with PKCE.
// TODO document _why_ auth-code-flow, and not e.g. implicit flow?

const { generators } = require('openid-client');
const config = require('config');
const { parse, render } = require('mustache');

const { safeNextPathFrom } = require('../util/html');
const { redirect } = require('../util/http');
const { createUserSession } = require('../http/sessions');
const { // eslint-disable-line object-curly-newline
  CODE_CHALLENGE_METHOD,
  RESPONSE_TYPE,
  SCOPES,
  getClient,
  getRedirectUri,
  isEnabled,
} = require('../util/oidc'); // eslint-disable-line camelcase,object-curly-newline

// TODO use req.protocol?
const envDomain = config.get('default.env.domain');
const HTTPS_ENABLED = envDomain.startsWith('https://');
const ONE_HOUR = 60 * 60 * 1000;

// Cannot use __Host- because cookie's Path is set
// Use __Secure- in production.  But not in dev - even though firefox will
// support __Secure with localhost, chrome will not.  Note that this behaviour
// is similar but distinct from the Secure attribute, which seems to send
// cookies to http://localhost on both Chrome and FireFox.
// See:
// * https://bugzilla.mozilla.org/show_bug.cgi?id=1648993
// * https://bugs.chromium.org/p/chromium/issues/detail?id=1056543
const CODE_VERIFIER_COOKIE = (HTTPS_ENABLED ? '__Secure-' : '') + 'ocv';
const STATE_COOKIE         = (HTTPS_ENABLED ? '__Secure-' : '') + 'next'; // eslint-disable-line no-multi-spaces
const callbackCookieProps = {
  httpOnly: true,
  secure: HTTPS_ENABLED,
  sameSite: 'Lax', // allow cookie to be sent on redirect from IdP
  path: '/v1/oidc/callback',
};

// id=cl only set for playwright. Why can't it locate this anchor in any other way?
const loaderTemplate = `
  <!doctype html>
  <html>
    <head>
      <title>Loading... | ODK Central</title>
      <meta http-equiv="refresh" content="0; url={{nextPath}}">
      <style>
        #container { text-align:center }

        .lds-spinner { display:inline-block; position:relative; width:80px; height:80px }
        .lds-spinner div { transform-origin:40px 40px; animation:lds-spinner 1.2s linear infinite }
        .lds-spinner div:after {
          content:" "; display:block; position:absolute; top:3px; left:37px;
          width:6px; height:18px; border-radius:20%; background:#000;
        }
        .lds-spinner div:nth-child(1) { transform:rotate(0deg); animation-delay:-1.1s }
        .lds-spinner div:nth-child(2) { transform:rotate(30deg); animation-delay:-1s }
        .lds-spinner div:nth-child(3) { transform:rotate(60deg); animation-delay:-0.9s }
        .lds-spinner div:nth-child(4) { transform:rotate(90deg); animation-delay:-0.8s }
        .lds-spinner div:nth-child(5) { transform:rotate(120deg); animation-delay:-0.7s }
        .lds-spinner div:nth-child(6) { transform:rotate(150deg); animation-delay:-0.6s }
        .lds-spinner div:nth-child(7) { transform:rotate(180deg); animation-delay:-0.5s }
        .lds-spinner div:nth-child(8) { transform:rotate(210deg); animation-delay:-0.4s }
        .lds-spinner div:nth-child(9) { transform:rotate(240deg); animation-delay:-0.3s }
        .lds-spinner div:nth-child(10) { transform:rotate(270deg); animation-delay:-0.2s }
        .lds-spinner div:nth-child(11) { transform:rotate(300deg); animation-delay:-0.1s }
        .lds-spinner div:nth-child(12) { transform:rotate(330deg); animation-delay:0s }
        @keyframes lds-spinner { 0% { opacity:1 } 100% { opacity:0 } }

        .continue-message { opacity:0; animation: 1s ease-in 10s 1 normal forwards fade-in; margin-top:1em }
        @keyframes fade-in { from { opacity:0 } to { opacity:1 } }
      </style>
    </head>
    <body>
      <div id="container">
        <div class="lds-spinner"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
        <div class="continue-message"><a href="{{nextPath}}" id="cl">Continue</a></div>
      </div>
    </body>
  </html>
`;
parse(loaderTemplate); // caches template for future perf.

const stateFor = next => [ generators.state(), Buffer.from(next).toString('base64url') ].join(':');
const nextFrom = state => {
  if (state) return Buffer.from(state.split(':')[1], 'base64url').toString();
};

module.exports = (service, endpoint) => {
  if (!isEnabled()) return;

  service.get('/oidc/login', endpoint.html(async ({ Sentry }, _, req, res) => {
    try {
      const client = await getClient();
      const code_verifier = generators.codeVerifier(); // eslint-disable-line camelcase

      const code_challenge = generators.codeChallenge(code_verifier); // eslint-disable-line camelcase

      const next = req.query.next ?? '';
      const state = stateFor(next);

      const authUrl = client.authorizationUrl({
        scope: SCOPES.join(' '),
        resource: `${envDomain}/v1`,
        code_challenge,
        code_challenge_method: CODE_CHALLENGE_METHOD,
        state,
      });

      res.cookie(CODE_VERIFIER_COOKIE, code_verifier, { ...callbackCookieProps, maxAge: ONE_HOUR });
      res.cookie(STATE_COOKIE,         state,         { ...callbackCookieProps, maxAge: ONE_HOUR }); // eslint-disable-line no-multi-spaces

      redirect(307, authUrl);
    } catch (err) {
      if (redirect.isRedirect(err)) {
        throw err;
      } else {
        Sentry.captureException(err);
        return errorToFrontend(req, res, 'internal-server-error');
      }
    }
  }));

  service.get('/oidc/callback', endpoint.html(async (container, _, req, res) => {
    try {
      const code_verifier = req.cookies[CODE_VERIFIER_COOKIE]; // eslint-disable-line camelcase
      const state         = req.cookies[STATE_COOKIE];         // eslint-disable-line no-multi-spaces
      res.clearCookie(CODE_VERIFIER_COOKIE, callbackCookieProps);
      res.clearCookie(STATE_COOKIE,         callbackCookieProps); // eslint-disable-line no-multi-spaces

      const client = await getClient();

      const params = client.callbackParams(req);

      const tokenSet = await client.callback(getRedirectUri(), params, { response_type: RESPONSE_TYPE, code_verifier, state });

      const { access_token } = tokenSet;

      const userinfo = await client.userinfo(access_token);

      const { email, email_verified } = userinfo;
      if (!email) {
        container.Sentry.captureException(new Error(`Required claim not provided in UserInfo Response: 'email'`));
        return errorToFrontend(req, res, 'email-claim-not-provided');
      }
      if (!email_verified) return errorToFrontend(req, res, 'email-not-verified'); // eslint-disable-line camelcase

      const user = await getUserByEmail(container, email);
      if (!user) return errorToFrontend(req, res, 'auth-ok-user-not-found');

      await initSession(container, req, res, user);

      const nextPath = safeNextPathFrom(nextFrom(state));

      // This redirect would be ideal, but breaks `SameSite: Secure` cookies.
      // return redirect(303, nextPath);
      // Instead, we need to render a page and then "browse" from that page to the normal frontend:

      return render(loaderTemplate, { nextPath });
    } catch (err) {
      if (redirect.isRedirect(err)) {
        throw err;
      } else {
        container.Sentry.captureException(err);
        return errorToFrontend(req, res, 'internal-server-error');
      }
    }
  }));
};

function errorToFrontend(req, res, errorCode) {
  const loginUrl = new URL('/#/login', envDomain);

  loginUrl.searchParams.append('oidcError', errorCode);

  const next = nextFrom(req.cookies[STATE_COOKIE]);
  if (next && !Array.isArray(next)) loginUrl.searchParams.append('next', next);

  // Append query string manually, because Central Frontend expects search/hash
  // in the wrong order (Vue hash-based routing).
  const redirectUrl = envDomain + loginUrl.pathname + loginUrl.hash + loginUrl.search;

  redirect(303, redirectUrl);
}

async function getUserByEmail({ Users }, email) {
  const userOption = await Users.getByEmail(email);
  if (userOption.isEmpty()) return;

  const user = userOption.get();

  return user;
}

async function initSession(container, req, res, user) {
  const applySession = await createUserSession(container, req.headers, user);
  applySession(req, res);
}
