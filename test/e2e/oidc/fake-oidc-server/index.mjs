// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

import Path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';

import express from 'express';
import Provider from 'oidc-provider';

const port = 9898;
const rootUrl = process.env.FAKE_OIDC_ROOT_URL;
if (!rootUrl) throw new Error('Missing env var: FAKE_OIDC_ROOT_URL');

const loadJson = path => JSON.parse(fs.readFileSync(path, { encoding: 'utf8' }));

const ACCOUNTS_JSON_PATH = Path.resolve('./accounts.json');
const ACCOUNTS = loadJson(ACCOUNTS_JSON_PATH);

const pkg = loadJson('../../../../package.json');
// eslint-disable-next-line no-console
const log = (...args) => console.log(pkg.name, new Date().toISOString(), 'INFO', ...args);
log.info = log;

function forHumans(o) {
  if (o == null) return o;
  if (typeof o === 'object') return JSON.stringify(o, null, 2);
  return o;
}

const oidc = new Provider(rootUrl, {
  scopes: ['email'],
  claims: { email: ['email', 'email_verified'] },

  clients: [{
    client_id: 'odk-central-backend-dev',
    client_secret: 'super-top-secret',
    redirect_uris: ['http://localhost:8989/v1/oidc/callback', 'https://odk-central.example.org:8989/v1/oidc/callback'],
  }],

  features: {
    resourceIndicators: {
      enabled: true,
      getResourceServerInfo: () => ({}),
    },
  },

  async findAccount(ctx, id) {
    const account = ACCOUNTS[id];
    if (!account) {
      log.info(`findAccount() :: User account '${id}' not found!  Check ${ACCOUNTS_JSON_PATH}!`);
      throw new Error(`User account '${id}' not found!  Check ${ACCOUNTS_JSON_PATH}!`);
    }

    const ret = {
      accountId: id,
      async claims(use, scope) {
        log.info('findAccount.claims()', { this: this, use, scope });
        const claims = { sub: id, ...account };
        log.info('findAccount.claims()', 'returning:', claims);
        return claims;
      },
    };
    log.info('findAccount()', 'found:', ret);
    return ret;
  },

  async renderError(ctx, out, err) {
    log('renderError()', err);
    ctx.type = 'html';
    ctx.body = `
      <html>
        <head><title>Error</title></head>
        <body>
          <div>
            <h1>Error</h1>
            <code><pre>${err}</pre></code>
            <h2>Stack</h2>
            <code><pre>${err.stack}</pre></code>
            <h2>Info</h2>
            ${Object.entries(out).map(([key, value]) => `<pre><strong>${key}</strong>: ${forHumans(value)}</pre>`).join('')}
            <h2>Configured Accounts</h2>
            <code><pre>${forHumans(ACCOUNTS)}</pre></code>
            <h2>Tips</h2>
            <ul>
              <li>If you restarted the fake-oidc-server while viewing the login page, you'll need to restart your auth flow.  Click "back to login" below.</li>
              <li>To delete an auth session with fake-oidc-server, restart it!  If running with <code>nodemon</code>/<code>make dev-oidc</code> you can do this by typing <code>rs</code> and pressing <code>&lt;enter&gt;</code>.</li>
              <li>Note that the login form expects the account's <i>username</i>, <b>not</b> email address.  This is to highlight that auth servers can choose their own authentication mechanisms, but will share the user's email back to the <code>odk-central-backend</code> server.</li>
              <li>If your user exists in the OIDC server, but not in <code>odk-central-backend</code>'s database, try running <code>node lib/bin/cli.js --email &lt;your email here&gt; user-create</code></li>
            </ul>
            <br/>
            [ <a href="http://localhost:8989/">back to login</a> ]
          </div>
        </body>
      </html>
    `;
  },
});

[
  'access_token.destroyed',
  'access_token.saved',
  'access_token.issued',
  'authorization_code.consumed',
  'authorization_code.destroyed',
  'authorization_code.saved',
  'authorization.accepted',
  'authorization.error',
  'authorization.success',
  'backchannel.error',
  'backchannel.success',
  'jwks.error',
  'client_credentials.destroyed',
  'client_credentials.saved',
  'client_credentials.issued',
  'device_code.consumed',
  'device_code.destroyed',
  'device_code.saved',
  'discovery.error',
  'end_session.error',
  'end_session.success',
  'grant.error',
  'grant.revoked',
  'grant.success',
  'initial_access_token.destroyed',
  'initial_access_token.saved',
  'interaction.destroyed',
  'interaction.ended',
  'interaction.saved',
  'interaction.started',
  'introspection.error',
  'replay_detection.destroyed',
  'replay_detection.saved',
  'pushed_authorization_request.error',
  'pushed_authorization_request.success',
  'pushed_authorization_request.destroyed',
  'pushed_authorization_request.saved',
  'refresh_token.consumed',
  'refresh_token.destroyed',
  'refresh_token.saved',
  'registration_access_token.destroyed',
  'registration_access_token.saved',
  'registration_create.error',
  'registration_create.success',
  'registration_delete.error',
  'registration_delete.success',
  'registration_read.error',
  'registration_update.error',
  'registration_update.success',
  'revocation.error',
  'server_error',
  'session.destroyed',
  'session.saved',
  'userinfo.error',
].forEach(eventName => {
  log('Adding event listener for:', eventName);
  oidc.on(eventName, (...args) => {
    log(`event:${eventName}`, args);
  });
});

let app;
if (rootUrl.startsWith('https://')) {
  const key  = fs.readFileSync('../certs/fake-oidc-server.example.net-key.pem', 'utf8'); // eslint-disable-line no-multi-spaces
  const cert = fs.readFileSync('../certs/fake-oidc-server.example.net.pem', 'utf8');
  app = express.createServer({ key, cert });
} else {
  app = express();
}

app.use(oidc.callback());

app.listen(port, () => {
  log(`oidc-provider listening on port ${port}, check ${rootUrl}/.well-known/openid-configuration`);
});
