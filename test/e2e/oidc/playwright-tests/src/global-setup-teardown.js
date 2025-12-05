// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-multi-spaces,template-curly-spacing */

// globalSetup() returns globalTeardown()
// See: https://playwright.dev/docs/test-global-setup-teardown#configure-globalsetup-and-globalteardown
module.exports = async function globalSetup() {
  const fakeFrontend = await startFakeFrontend(); // eslint-disable-line no-use-before-define
  return function globalTeardown() {
    fakeFrontend.close();
  };
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');

const { port, frontendUrl } = require('./config');
const backendUrl = 'http://localhost:8383';

async function startFakeFrontend() {
  console.log('Starting fake frontend proxy...'); // eslint-disable-line no-console
  const fakeFrontend = express();
  fakeFrontend.use(cookieParser());
  fakeFrontend.use('/v1', createProxyMiddleware({ target: backendUrl }));
  fakeFrontend.get('*',    successHandler); // eslint-disable-line no-use-before-define

  if (frontendUrl.startsWith('http://')) {
    return fakeFrontend.listen(port);
  } else {
    const fs = require('node:fs');
    const https = require('node:https');
    const key  = fs.readFileSync('../certs/odk-central.example.org-key.pem', 'utf8');
    const cert = fs.readFileSync('../certs/odk-central.example.org.pem', 'utf8');
    const httpsServer = https.createServer({ key, cert }, fakeFrontend);
    await httpsServer.listen(port);
    return httpsServer;
  }
}

function html([ first, ...rest ], ...vars) {
  return (`
    <html>
      <body>
        ${first + vars.map((v, idx) => [ v, rest[idx] ]).flat().join('')}
      </body>
    </html>
  `);
}

function successHandler(req, res) {
  // include request details in response body to allow for:
  //
  // * testing values in playwright
  // * getting helpful debug info in screenshots
  const reqDetails = {
    url: req.url,
    originalUrl: req.originalUrl,
    hostname: req.hostname,
  };

  res.send(html`
    <style>body { font-size:8px; }</style> <!-- fit more output on the screen -->
    <h1>${req.url} success!</h1>
    <h2>Request Details</h2>
    <div><h3>Path         </h3><pre id="request-details">${     JSON.stringify(reqDetails,  null, 2)}</pre></div>
    <div><h3>Headers      </h3><pre id="request-headers">${     JSON.stringify(req.headers, null, 2)}</pre></div>
    <div><h3>Query Params </h3><pre id="request-query-params">${JSON.stringify(req.query,   null, 2)}</pre></div>
    <div><h3>Cookies      </h3><pre id="request-cookies">${     JSON.stringify(req.cookies, null, 2)}</pre></div>
    <div><h3>location.href</h3><pre id="location-href"></pre></div>
    <script>document.getElementById('location.href').textContent = window.location.href;</script>
  `);
}
