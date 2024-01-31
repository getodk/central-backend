// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const fs = require('node:fs');
const fetch = require('node-fetch');
const _ = require('lodash');
const uuid = require('uuid').v4;
const { basename } = require('node:path');
const { program } = require('commander');

const _log = (...args) => console.log(`[${new Date().toISOString()}]`, '[soak-tester]', ...args);
const log  = (...args) => true  && _log('INFO',   ...args);
log.debug  = (...args) => false && _log('DEBUG',  ...args);
log.info   = log;
log.error  = (...args) => true  && _log('ERROR',  ...args);
log.report = (...args) => true  && _log('REPORT', ...args);

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8989')
    .option('-u, --user-email <userEmail>', 'Email of central user', 'x@example.com')
    .option('-P, --user-password <userPassword>', 'Password of central user', 'secret')
    ;
program.parse();
const { serverUrl, userEmail, userPassword } = program.opts();

// TODO create draft form
// TODO add form attachments
// TODO attempt to download form attachments

let bearerToken;

runTest();

async function runTest() {
  log.info('Setting up...');

  log.info('Creating session...');
  const { token } = await apiPostJson('sessions', { email:userEmail, password:userPassword }, { Authorization:null });
  bearerToken = token;

  log.info('Creating project...');
  const { id:projectId } = await apiPostJson('projects', { name:`soak-test-${new Date().toISOString().replace(/\..*/, '')}` });

  log.info('Uploading form...');
  const { xmlFormId:formId } = await apiPostFile(`projects/${projectId}/forms`, 'test/s3-e2e/test-form.xml');

  log.info('Uploading attachments...');
  await Promise.all(
    fs.readdirSync('test/s3-e2e/test-attachments')
      .map(f => apiPostFile(`projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}`, f)),
  );

  log('Downloading attachments...');
  const attachments = await apiGet(`projects/{projectId}/forms/{xmlFormId}/attachments`);

  for(const att of attachments) {
    const res = await apiRawGet(`projects/{projectId}/forms/{xmlFormId}/attachments/${att}`);

    // TODO assert some stuff about the returned attachment / headers
  }
}

function apiPostFile(path, filePath) {
  const mimeType = mimetypeFor(filePath);
  const blob = fileFromSync(filePath, mimeType);
  return apiPost(path, blob, { 'Content-Type':mimeType });
}

function apiPostJson(path, body, headers) {
  return apiPost(path, JSON.stringify(body), { 'Content-Type':'application/json', ...headers });
}

async function apiPost(path, body, headers) {
  const res = await apiFetch('POST', path, body, headers);
  return res.json();
}

async function apiFetch(method, path, body, extraHeaders) {
  const url = `${serverUrl}/v1/${path}`;

  const Authorization = bearerToken ? `Bearer ${bearerToken}` : `Basic ${base64(`${userEmail}:${userPassword}`)}`;

  const headers = { Authorization, ...extraHeaders };
  // unset null/undefined Authorization value to prevent fetch() from stringifying it:
  if(headers.Authorization == null) delete headers.Authorization;

  const res = await fetch(url, {
    method,
    body,
    headers,
  });
  log.debug(method, res.url, '->', res.status);
  if(!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}
