// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable */

const TIMEOUT = 120000; // ms

const fs = require('node:fs');
const fetch = require('node-fetch');
const { randomBytes } = require('node:crypto');
const { basename } = require('node:path');
const { program } = require('commander');
const should = require('should');

const SUITE_NAME = 'test/e2e/s3';
const log = require('../util/logger')(SUITE_NAME);
const { apiClient, mimetypeFor, Redirect } = require('../util/api');

const serverUrl = 'http://localhost:8383';
const userEmail = 'x@example.com';
const userPassword = 'secret1234';

const attDir = './test-attachments';
const BIGFILE = `${attDir}/big.bin`;

describe('s3 support', () => {
  let api, projectId, xmlFormId;

  it('should shift submission attachments to s3', async function() {
    this.timeout(TIMEOUT*2);

    // given
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

    const project = await api.apiPostJson('projects', { name:`soak-test-${new Date().toISOString().replace(/\..*/, '')}` });
    projectId = project.id;

    const xml = await api.apiPostFile(`projects/${projectId}/forms`, './test-form.xml');
    xmlFormId = xml.xmlFormId;

    await Promise.all(
      fs.readdirSync(attDir)
        .filter(f => !f.startsWith('.'))
        .map(f => api.apiPostFile(`projects/${projectId}/forms/${xmlFormId}/draft/attachments/${f}`, `${attDir}/${f}`)),
    );

    // when
    const attachments = await api.apiGet(`projects/${projectId}/forms/${xmlFormId}/attachments`);

    // then
    await assertAllRedirect(attachments);
    await assertAllDownloadsMatchOriginal(attachments);
  });

  function assertAllRedirect(attachments) {
    const timeout = Date.now() + TIMEOUT;

    return new Promise((resolve, reject) => {
      setImmediate(check);

      async function check() {
        try {
          for(const att of attachments) {
            log.debug('assertAllRedirect()', 'checking attachment:', att.name);
            const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
            if(!(res instanceof Redirect)) {
              log.debug('assertAllRedirect()', 'Attachment did not redirect:', att.name);
              if(Date.now() > timeout) reject(new Error(`Timeout out after ${TIMEOUT/1000}s.`));
              else {
                log.debug('Sleeping...');
                setTimeout(check, 500);
              }
              return;
            }
          }
        } catch (err) {
          reject(err);
        }
        resolve(); // all redirected
      }
    });
  }

  async function assertAllDownloadsMatchOriginal(attachments) {
    for(const att of attachments) {
      const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
      if(!(res instanceof Redirect) || res.status !== 307) {
        throw new Error(`Unexpected redirect for attachment ${JSON.stringify(att)}: ${res}`);
      }

      await assertDownloadMatchesOriginal(att, res.location);
    }
  }

  async function assertDownloadMatchesOriginal({ name }, url) {
    const filepath = `${attDir}/${name}`;
    log.debug('assertDownloadMatchesOriginal()', { filepath, url });

    const res = await fetch(url);
    should.ok(res.ok);

    const expectedContentType = mimetypeFor(name);
    const actualContentType = res.headers.get('content-type');
    should.equal(actualContentType, expectedContentType);

    const resContent = await res.buffer();
    const fileContent = fs.readFileSync(filepath);
    should.equal(resContent.length, fileContent.length);

    // Comparing streams might be faster; this is acceptably fast at the moment.
    for(let i=0; i<fileContent.length; ++i) {
      should.equal(resContent[i], fileContent[i]);
    }
  }
});
