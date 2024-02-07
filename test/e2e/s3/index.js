// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable */

// FIXME a lot of this code is shared with soak-tester.  Refactor to share, possibly by moving
// soak-tester into test/e2e/soak, and moving common code into e.g. test/e2e/util.  The request
// handling, tracking of bearer token etc. could be nicely wrapped up in an api session object.


const fs = require('node:fs');
const fetch = require('node-fetch');
const { randomBytes } = require('node:crypto');
const { basename } = require('node:path');
const { program } = require('commander');
const should = require('should');

const SUITE_NAME = 'test/e2e/s3';
const log = require('../util/logger')(SUITE_NAME);
const { apiClient, mimetypeFor, Redirect } = require('../util/api');

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8383')
    .option('-u, --user-email <userEmail>', 'Email of central user', 'x@example.com')
    .option('-P, --user-password <userPassword>', 'Password of central user', 'topSecret123')
    ;
program.parse();
const { serverUrl, userEmail, userPassword } = program.opts();

const attDir = 'test/e2e/s3/test-attachments';
const BIGFILE = `${attDir}/big.bin`;

let api;

runTest();

async function runTest() {
  log.info('Setting up...');

  if(fs.existsSync(BIGFILE)) {
    log.info('big.bin exists; skipping generation');
  } else {
    log.info('Generating big.bin...');
    let remaining = 100000000;
    const batchSize = 100000;
    do {
      fs.appendFileSync(BIGFILE, randomBytes(batchSize));
    } while((remaining-=batchSize) > 0);
  }

  api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword });

  log.info('Creating project...');
  const { id:projectId } = await api.apiPostJson('projects', { name:`soak-test-${new Date().toISOString().replace(/\..*/, '')}` });

  log.info('Uploading form...');
  const { xmlFormId } = await api.apiPostFile(`projects/${projectId}/forms`, 'test/e2e/s3/test-form.xml');

  log.info('Uploading attachments...');
  await Promise.all(
    fs.readdirSync(attDir)
      .filter(f => !f.startsWith('.'))
      .map(f => api.apiPostFile(`projects/${projectId}/forms/${xmlFormId}/draft/attachments/${f}`, `${attDir}/${f}`)),
  );

  log('Downloading attachments list...');
  const attachments = await api.apiGet(`projects/${projectId}/forms/${xmlFormId}/attachments`);

  log.debug('Got attachments list:', attachments);
  await allRedirect(attachments);
  for(const att of attachments) {
    const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
    if(!(res instanceof Redirect) || res.status !== 307) {
      throw new Error(`Unexpected redirect for attachment ${JSON.stringify(att)}: ${res}`);
    }

    await assertFileEqualsFetch(att, res.location);
  }

  log.report('All OK.');

  function allRedirect(attachments) {
    const TIMEOUT = 120000; // ms
    const timeout = Date.now() + TIMEOUT;

    return new Promise((resolve, reject) => {
      setImmediate(check);

      async function check() {
        for(const att of attachments) {
          log.debug('allRedirect()', 'checking attachment:', att.name);
          const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
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

function fileExtensionFrom(f) {
  try {
    return basename(f).match(/\.([^.]*)$/)[1];
  } catch(err) {
    throw new Error(`Could not get file extension from filename '${f}'!`);
  }
}
