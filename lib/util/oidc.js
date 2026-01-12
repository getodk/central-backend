// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Allow aligning object properties and function arguments for readability:
/* eslint-disable key-spacing,no-multi-spaces */

// Allow defining utility functions at the bottom of the file:
/* eslint-disable no-use-before-define */

// OpenID settings, algorithms etc.
// Keep an eye on updates to recommendations in case these need updating.
// See: TODO add link to where to get up-to-date recommendations
const CODE_CHALLENGE_METHOD = 'S256'; // S256 PKCE
const REQUIRED_CLAIMS = ['email', 'email_verified'];
const RESPONSE_TYPE = 'code';
const SCOPES = ['openid', 'email'];
const TOKEN_SIGNING_ALG = 'RS256';
const TOKEN_ENDPOINT_AUTH_METHOD = 'client_secret_basic';

module.exports = {
  CODE_CHALLENGE_METHOD,
  RESPONSE_TYPE,
  SCOPES,
  getClient,
  getRedirectUri,
  isEnabled,
};

const config = require('config');
const { Issuer } = require('openid-client');

const oidcConfig = (config.has('default.oidc') && config.get('default.oidc')) || {};

function isEnabled() {
  // This is AN EXPLICIT SETTING rather than derived from e.g. client init
  // failing - we don't want to default to a different authN method to that
  // requested by the system administrator.
  return oidcConfig.enabled === true;
}

function getRedirectUri() {
  return `${config.get('default.env.domain')}/v1/oidc/callback`;
}

let clientLoader; // single instance, initialised lazily
function getClient() {
  if (!clientLoader) clientLoader = initClient();
  return clientLoader;
}
async function initClient() {
  if (!isEnabled()) throw new Error('OIDC is not enabled.');

  try {
    assertHasAll('config keys', Object.keys(oidcConfig), ['issuerUrl', 'clientId', 'clientSecret']);

    const { issuerUrl } = oidcConfig;
    const issuer = await Issuer.discover(issuerUrl);

    // eslint-disable-next-line object-curly-newline
    const {
      claims_supported,
      code_challenge_methods_supported,
      id_token_signing_alg_values_supported,
      response_types_supported,
      scopes_supported,
      token_endpoint_auth_methods_supported,
    } = issuer.metadata; // eslint-disable-line object-curly-newline

    // This code uses email to verify a user's identity.  An unverified email
    // address is not suitable for verification.
    //
    // For some providers, this may require explicit configuration[1]; for other providers, email may not be supported at all as a form of verification[2].
    //
    // Iff a provider advertises the email_verified claim, we assume that the
    // email claim is sufficient to verify the user's identity.
    //
    // [1]: https://developers.onelogin.com/openid-connect/guides/email-verified
    // [2]: https://learn.microsoft.com/en-us/azure/active-directory/develop/claims-validation

    // In the spec:  scopes_supported is optional, but recommended.
    // In this code: scopes_supported is required.
    // see: https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
    if (!scopes_supported) throw new Error('scopes_supported was not provided in issuer metadata.'); // eslint-disable-line camelcase
    // In the spec:  supported scopes may not be included in scopes_supported.
    // In this code: required  scopes  *must* be included in scopes_supported.
    // see: https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
    assertHasAll('scopes', scopes_supported, SCOPES);

    // In the spec:  claims_supported is optional, but recommended.
    // In this code: claims_supported is required.
    // see: https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
    if (!claims_supported) throw new Error('claims_supported was not provided in issuer metadata.'); // eslint-disable-line camelcase
    // In the spec:  supported claims may not be included in claims_supported.
    // In this code: supported claims  *must* be included in claims_supported.
    // see: https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
    assertHasAll('required claims', claims_supported, REQUIRED_CLAIMS);

    assertHas('response type',              response_types_supported,              RESPONSE_TYPE);
    assertHas('code challenge method',      code_challenge_methods_supported,      CODE_CHALLENGE_METHOD);
    assertHas('token signing alg',          id_token_signing_alg_values_supported, TOKEN_SIGNING_ALG);
    assertHas('token endpoint auth method', token_endpoint_auth_methods_supported, TOKEN_ENDPOINT_AUTH_METHOD);

    const client = new issuer.Client({
      client_id:      oidcConfig.clientId,
      client_secret:  oidcConfig.clientSecret,
      redirect_uris:  [getRedirectUri()],
      response_types: [RESPONSE_TYPE],
      id_token_signed_response_alg: TOKEN_SIGNING_ALG,
      token_endpoint_auth_method: TOKEN_ENDPOINT_AUTH_METHOD,
    });

    return client;
  } catch (cause) {
    // N.B. don't include the config here - it might include the client secret, perhaps in the wrong place.
    throw new Error('Failed to configure OpenID Connect client', { cause });
  }
}

function assertHas(name, actual, required) {
  if (!actual.includes(required)) {
    throw new Error(`Missing required ${name}.  Wanted: ${required}, but got ${actual}!`);
  }
}

function assertHasAll(name, actual, required) {
  if (!required.every(v => actual.includes(v))) {
    throw new Error(`Missing required ${name}.  Wanted: ${required}, but got ${actual}!`);
  }
}
