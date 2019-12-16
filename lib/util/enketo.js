// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// here we support previewing forms (and hopefully other things in the future)
// by providing a very thin wrapper around node http requests to Enketo. given
// an OpenRosa endpoint to access a form's xml and its media, Enketo should
// return a preview url, which we then pass untouched to the client.

const http = require('http');
const https = require('https');
const path = require('path');
const querystring = require('querystring');
const { isBlank } = require('./util');
const Problem = require('./problem');

const mock = {
  preview: () => Promise.reject(Problem.internal.enketoNotConfigured())
};

const enketo = (hostname, pathname, port, protocol, apiKey) => ({
  preview: (openRosaUrl, xmlFormId, response) => new Promise((resolve, reject) => {
    const previewPath = path.posix.join(pathname, 'api/v2/survey/preview');
    const auth = `${apiKey}:`;
    const postData = querystring.stringify({ server_url: openRosaUrl, form_id: xmlFormId });
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    };

    const request = protocol === 'https:' ? https.request : http.request;
    const req = request({ hostname, port, headers, method: 'POST', path: previewPath, auth }, (res) => {
      const resData = [];
      res.on('data', (d) => { resData.push(d); });
      res.on('error', reject);
      res.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(resData)); } catch (ex) {
          reject(Problem.internal.enketoUnexpectedResponse('invalid JSON'));
        }
        if (res.statusCode === 200 || res.statusCode === 201) {
          response.statusCode = res.statusCode;
          resolve(body);
        } else reject(Problem.internal.enketoUnexpectedResponse('wrong status code'));
      });
    });

    req.on('error', (error) => { reject(Problem.internal.enketoNotAvailable({ error })); });

    req.write(postData);
    req.end();
  })
});

// sorts through config and returns an object containing stubs or real functions for Enketo integration.
// (okay, right now it's just one function)
const init = (config) => {
  if (config == null) return mock;
  if (isBlank(config.url) || isBlank(config.apiKey)) return mock;
  let parsedUrl;
  try {
    parsedUrl = new URL(config.url);
  } catch (ex) {
    if (ex instanceof TypeError) return mock; // configuration has an invalid Enketo URL
    else throw ex;
  }
  const { hostname, pathname, port, protocol } = parsedUrl;
  return enketo(hostname, pathname, port, protocol, config.apiKey);
};

module.exports = { init };

