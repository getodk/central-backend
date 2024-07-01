// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable */

const TIMEOUT = 120000; // ms

const child_process = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { basename } = require('node:path');
const _ = require('lodash');
const { program } = require('commander');
const should = require('should');

const exec = promisify(child_process.exec);

const SUITE_NAME = 'test/e2e/s3';
const log = require('../util/logger')(SUITE_NAME);
const { apiClient, mimetypeFor, Redirect } = require('../util/api');

const serverUrl = 'http://localhost:8383';
const userEmail = 'x@example.com';
const userPassword = 'secret1234';

const attDir = './test-attachments';
const BIGFILE = `${attDir}/big.bin`;

describe('s3 support', () => {
  let api, expectedAttachments, projectId, xmlFormId;

  beforeEach(async function() {
    this.timeout(TIMEOUT*2);

    // given
    bigFileExists();
    expectedAttachments = fs.readdirSync(attDir).filter(f => !f.startsWith('.')).sort();
    api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword });
    projectId = await createProject();
    xmlFormId = await uploadFormWithAttachments('test-form.xml');

    // when
    const actualAttachments = await api.apiGet(`projects/${projectId}/forms/${xmlFormId}/attachments`);
    should.deepEqual(actualAttachments.map(a => a.name).sort(), expectedAttachments);

    // then
    should.equal(await cli('count-blobs pending'), 11);
    should.equal(await cli('count-blobs uploaded'), 0);
    // and
    await assertNoneRedirect(actualAttachments);
  });

  it('should shift submission attachments to s3', async function() {
    this.timeout(TIMEOUT*2);

    // when
    await cli('upload-pending');

    // then
    should.equal(await cli('count-blobs pending'), 0);
    should.equal(await cli('count-blobs uploaded'), 11);
    // and
    await assertAllRedirect(actualAttachments);
    await assertAllDownloadsMatchOriginal(actualAttachments);
  });

  it.only('should continue to serve blobs while upload-pending is running', async function() {
    this.timeout(TIMEOUT*2);

    // when
    const uploading = cli('upload-pending');
    while(await cli('count-blobs pending') !== '1') { sleep(100); }

    // and
    const res = await api.apiRawGet(`projects/${projectId}/forms/${xmlFormId}/attachments/big.bin`);
    return assertDownloadMatchesOriginal(res, 'big.bin');

    // cleanup
    await uploading;
  });

  it('should gracefully handle simultaneous calls to upload-pending', async function() {
    this.timeout(TIMEOUT*2);

    throw new Error('TODO');
  });

  it('should gracefully handle upload-pending dying unexpectedly', async function() {
    this.timeout(TIMEOUT*2);

    throw new Error('TODO');
  });

  async function createProject() {
    const project = await api.apiPostJson(
      'projects',
      { name:`s3-test-${new Date().toISOString().replace(/\..*/, '')}` },
    );
    return project.id;
  }

  async function uploadFormWithAttachments(xmlFilePath) {
    const { xmlFormId } = await api.apiPostFile(`projects/${projectId}/forms`, xmlFilePath);

    await Promise.all(
      expectedAttachments
        .map(f => api.apiPostFile(
          `projects/${projectId}/forms/${xmlFormId}/draft/attachments/${f}`,
          `${attDir}/${f}`,
        ))
    );

    return xmlFormId;
  }

  async function assertNoneRedirect(attachments) {
    for(const att of attachments) {
      log.info('assertNoneRedirect()', 'checking attachment:', att.name);
      const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
      should.ok(!(res instanceof Redirect), `${att.name} is a redirect!`);
      should.equal(res.status, 200);
      log.info('assertNoneRedirect()', '  Looks OK.');
    }
  }

  async function assertAllRedirect(attachments) {
    for(const att of attachments) {
      log.info('assertAllRedirect()', 'checking attachment:', att.name);
      const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
      should.ok(res instanceof Redirect, `${att.name} is not a redirect - returned HTTP status: ${res.status}`);
      log.info('assertAllRedirect()', '  Looks OK.');
    }
  }

  async function assertAllDownloadsMatchOriginal(attachments) {
    for(const att of attachments) {
      const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
      if(!(res instanceof Redirect) || res.status !== 307) {
        throw new Error(`Unexpected response for attachment ${JSON.stringify(att)}: ${res}`);
      }

      const res2 = await fetch(res.location);
      return assertDownloadMatchesOriginal(res2, att.name);
    }
  }

  async function assertDownloadMatchesOriginal(res, name) {
    should.ok(res.ok);

    const filepath = `${attDir}/${name}`;

    const expectedContentType = mimetypeFor(name);
    const actualContentType = res.headers.get('content-type');
    should.equal(actualContentType, expectedContentType);

    const resContent = new Uint8Array(await res.arrayBuffer());
    const fileContent = fs.readFileSync(filepath);
    should.equal(resContent.length, fileContent.length);

    // Comparing streams might be faster; this is acceptably fast at the moment.
    for(let i=0; i<fileContent.length; ++i) {
      should.equal(resContent[i], fileContent[i]);
    }
    log.info('assertDownloadMatchesOriginal()', '  Looks OK.');
  }
});

function bigFileExists() {
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
}

async function cli(cmd) {
  cmd = `node lib/bin/s3 ${cmd}`;
  log.info('cli()', 'calling:', cmd);
  const env = { ..._.pick(process.env, 'PATH'), NODE_CONFIG_ENV:'s3-dev' };
  const { stdout } = await exec(cmd, { env, cwd:'../../..' })
  const res = stdout.toString().trim();
  log.info('cli()', 'returned:', res);
  return res;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
