// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const http = require('http');
const https = require('https');
const { posix } = require('path');
const { URL } = require('url');
const querystring = require('querystring');
const { url } = require('../util/http');
const { isBlank } = require('../util/util');
const Problem = require('../util/problem');

// Returns a very thin wrapper around Node HTTP requests for sending requests to
// Enketo. The methods of the object can be used to send requests to Enketo.
const _init = (hostname, pathname, port, protocol, apiKey) => {
  const enketoRequest = (apiPath, token, postData) => new Promise((resolve, reject) => {
    const path = posix.join(pathname, apiPath);
    const auth = `${apiKey}:`;
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
      Cookie: `__Host-session=${token}`
    };

    const request = protocol === 'https:' ? https.request : http.request;
    const req = request({ hostname, port, headers, method: 'POST', path, auth }, (res) => {
      const resData = [];
      res.on('data', (d) => { resData.push(d); });
      res.on('error', reject);
      res.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(resData)); } // eslint-disable-line brace-style
        catch (ex) { return reject(Problem.internal.enketoUnexpectedResponse('invalid JSON')); }

        if ((res.statusCode === 405) && (body.message === 'Not allowed. Record is already being edited'))
          return reject(Problem.user.enketoEditRateLimit());
        if ((res.statusCode !== 200) && (res.statusCode !== 201))
          return reject(Problem.internal.enketoUnexpectedResponse('wrong status code'));
        resolve(body);
      });
    });

    req.on('error', (error) => { reject(Problem.internal.enketoNotAvailable({ error })); });

    req.write(postData);
    req.end();
  });

  // openRosaUrl is the OpenRosa endpoint for Enketo to use to access the form's
  // XML and attachments.
  const create = async (openRosaUrl, xmlFormId, token) => {
    const body = await enketoRequest('/api/v2/survey/all', token, querystring.stringify({
      server_url: openRosaUrl,
      form_id: xmlFormId
    }));

    // Parse enketoOnceId from single_once_url.
    const match = /\/([:a-z0-9]+)$/i.exec(body.single_once_url);
    if (match == null) throw Problem.internal.enketoUnexpectedResponse(`Could not parse token from single_once_url: ${body.single_once_url}`);
    const enketoOnceId = match[1];

    return { enketoId: body.enketo_id, enketoOnceId };
  };

  const edit = (openRosaUrl, domain, form, logicalId, submissionDef, attachments, token) => {
    const attsMap = {};
    for (const att of attachments)
      if (att.blobId != null)
        attsMap[url`instance_attachments[${att.name}]`] = domain + url`/v1/projects/${form.projectId}/forms/${form.xmlFormId}/submissions/${logicalId}/versions/${submissionDef.instanceId}/attachments/${att.name}`;

    return enketoRequest('api/v2/instance', token, querystring.stringify({
      server_url: openRosaUrl,
      form_id: form.xmlFormId,
      instance: submissionDef.xml,
      instance_id: submissionDef.instanceId,
      ...attsMap,
      return_url: domain + url`/projects/${form.projectId}/forms/${form.xmlFormId}/submissions/${logicalId}`
    }))
      .then(({ edit_url: enketoUrlStr }) => {
        // need to override proto/host/port with our own.
        const enketoUrl = new URL(enketoUrlStr);
        const ownUrl = new URL(domain);
        enketoUrl.protocol = ownUrl.protocol;
        enketoUrl.hostname = ownUrl.hostname;
        enketoUrl.port = ownUrl.port || '';
        return enketoUrl.href;
      });
  };

  return { create, edit };
};

const mock = {
  create: () => Promise.reject(Problem.internal.enketoNotConfigured()),
  edit: () => Promise.reject(Problem.internal.enketoNotConfigured())
};

// sorts through config and returns an object containing either stubs or real
// functions for Enketo integration.
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
  return _init(hostname, pathname, port, protocol, config.apiKey);
};

module.exports = { init };

