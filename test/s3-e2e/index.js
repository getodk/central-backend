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
const { randomBytes } = require('node:crypto');
const { basename } = require('node:path');
const { program } = require('commander');
const should = require('should');

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'REPORT']
const logLevel = process.env.LOG_LEVEL || 'INFO';
const _log = (level, ...args) => {
  if(LOG_LEVELS.indexOf(logLevel) > LOG_LEVELS.indexOf(level)) return;
  console.log(`[${new Date().toISOString()}]`, '[s3-e2e-test]', ...args);
};
const log  = (...args) => _log('INFO',   ...args);
log.debug  = (...args) => _log('DEBUG',  ...args);
log.info   = log;
log.error  = (...args) => _log('ERROR',  ...args);
log.report = (...args) => _log('REPORT', ...args);

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8383')
    .option('-u, --user-email <userEmail>', 'Email of central user', 'x@example.com')
    .option('-P, --user-password <userPassword>', 'Password of central user', 'topSecret123')
    ;
program.parse();
const { serverUrl, userEmail, userPassword } = program.opts();

const attDir = 'test/s3-e2e/test-attachments';
const BIGFILE = `${attDir}/big.bin`;

let bearerToken;

runTest();

async function runTest() {
  log.info('Setting up...');

  if(fs.existsSync(BIGFILE)) {
    log.info('big.bin exists; skipping generation');
  } else {
    log.info('Generating big.bin...');
    let remaining = 100_000_000;
    const batchSize = 100_000;
    do {
      fs.appendFileSync(BIGFILE, randomBytes(batchSize));
    } while((remaining-=batchSize) > 0);
  }

  log.info('Creating session...');
  const { token } = await apiPostJson('sessions', { email:userEmail, password:userPassword }, { Authorization:null });
  bearerToken = token;

  log.info('Creating project...');
  const { id:projectId } = await apiPostJson('projects', { name:`soak-test-${new Date().toISOString().replace(/\..*/, '')}` });

  log.info('Uploading form...');
  const { xmlFormId } = await apiPostFile(`projects/${projectId}/forms`, 'test/s3-e2e/test-form.xml');

  log.info('Uploading attachments...');
  await Promise.all(
    fs.readdirSync(attDir)
      .filter(f => !f.startsWith('.'))
      .map(f => apiPostFile(`projects/${projectId}/forms/${xmlFormId}/draft/attachments/${f}`, `${attDir}/${f}`)),
  );

  log('Downloading attachments list...');
  const attachments = await apiGet(`projects/${projectId}/forms/${xmlFormId}/attachments`);

  log.debug('Got attachments list:', attachments);
  await allRedirect(attachments);
  for(const att of attachments) {
    const res = await apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
    if(!(res instanceof Redirect) || res.status !== 307) {
      throw new Error(`Unexpected redirect for attachment ${JSON.stringify(att)}: ${res}`);
    }

    await assertFileEqualsFetch(att, res.location);
  }

  log.report('All OK.');

  function allRedirect(attachments) {
    const TIMEOUT = 120_000; // ms
    const timeout = Date.now() + TIMEOUT;

    return new Promise((resolve, reject) => {
      setImmediate(check);

      async function check() {
        for(const att of attachments) {
          log.debug('allRedirect()', 'checking attachment:', att.name);
          const res = await apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
          if(!(res instanceof Redirect)) {
            log.debug('allRedirect()', 'Attachment did not redirect:', att.name);
            if(Date.now() > timeout) reject(new Error(`Timeout out after ${TIMEOUT/1000}s.`));
            else {
              log.debug('Sleeping...');
              setTimeout(check, 500);
            }
            return;
          }
        }
        resolve(); // all redirected
      }
    });
  }
}

async function assertFileEqualsFetch({ name }, url) {
  const filepath = `${attDir}/${name}`;
  log.debug('assertFileEqualsFetch()', { filepath, url });

  const res = await fetch(url);
  should.ok(res.ok);

  const expectedContentType = mimetypeFor(name);
  const actualContentType = res.headers.get('content-type');
  should.equal(actualContentType, expectedContentType);

  const resContent = await res.buffer();
  const fileContent = fs.readFileSync(filepath);
  should.equal(resContent.length, fileContent.length);

  // comparing streams would be faster; let's see how slow this is
  for(let i=0; i<fileContent.length; ++i) {
    should.equal(resContent[i], fileContent[i]);
  }

  log.info('File', name, 'matched content fetched from', url);
}

function apiPostFile(path, filePath) {
  const mimeType = mimetypeFor(filePath);
  const blob = fs.readFileSync(filePath);
  return apiPost(path, blob, { 'Content-Type':mimeType });
}

function apiPostJson(path, body, headers) {
  return apiPost(path, JSON.stringify(body), { 'Content-Type':'application/json', ...headers });
}

async function apiPost(path, body, headers) {
  const res = await apiFetch('POST', path, body, headers);
  return res.json();
}

function apiRawHead(path, headers) {
  return apiFetch('HEAD', path, undefined, headers);
}

function apiRawGet(path, headers) {
  return apiFetch('GET', path, undefined, headers);
}

async function apiGet(path, headers) {
  const res = await apiFetch('GET', path, undefined, headers);
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
    redirect: 'manual',
  });
  log.debug(method, res.url, '->', res.status);

  if(isRedirected(res)) return new Redirect(res);
  if(!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

  return res;
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}

function mimetypeFor(f) {
  // For more, see: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
  const extension = fileExtensionFrom(f);
  log.debug('fileExtensionFrom()', f, '->', extension);
  switch(extension) {
    case 'bin' : return 'application/octet-stream';
    case 'jpg' : return 'image/jpeg';
    case 'png' : return 'image/png';
    case 'svg' : return 'image/svg+xml';
    case 'txt' : return 'text/plain';
    case 'xls' : return 'application/vnd.ms-excel';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xml' : return 'application/xml';
    default: throw new Error(`Unsure what mime type to use for: ${f}`);
  }
}

function fileExtensionFrom(f) {
  try {
    return basename(f).match(/\.([^.]*)$/)[1];
  } catch(err) {
    throw new Error(`Could not get file extension from filename '${f}'!`);
  }
}

function isRedirected(res) {
  // should support res.redirected, but maybe old version
  // See: https://www.npmjs.com/package/node-fetch#responseredirected
  return res.redirected || (res.status >=300 && res.status < 400);
}

class Redirect {
  constructor(res) {
    this.props = Object.freeze({
      status:   res.status,
      location: res.headers.get('location'),
      headers:  Object.freeze(res.headers.raw()),
    });
  }
  get status()   { return this.props.status; }
  get location() { return this.props.location; }
  get headers()  { return this.props.headers; }
}
