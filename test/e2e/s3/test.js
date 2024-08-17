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

const { exec, execSync } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { basename } = require('node:path');
const _ = require('lodash');
const { program } = require('commander');
const should = require('should');

const SUITE_NAME = 'test/e2e/s3';
const log = require('../util/logger')(SUITE_NAME);
const { apiClient, mimetypeFor, Redirect } = require('../util/api');

const serverUrl = 'http://localhost:8383';
const userEmail = 'x@example.com';
const userPassword = 'secret1234';

describe('s3 support', () => {
  let api, expectedAttachments, actualAttachments, projectId, xmlFormId, attDir;

  // Track of total blobs uploaded over all tests
  let previousBlobs = 0;

  let minioTerminated;
  const terminateMinio = () => {
    console.log('docker debug 1:', 'TODO remove me', '\n' + execSync('docker ps').toString());
    console.log('docker debug 2:', 'TODO remove me', '\n' + execSync('docker ps --filter "ancestor=minio/minio"').toString());
    console.log('docker debug 3:', 'TODO remove me', '\n' + execSync(`docker ps | awk '/minio/ { print $1 }'`).toString());
    // It should be possible to use docker more precisely here, e.g.
    //   docker stop $(docker ps --quiet --filter "ancestor=minio/minio")
    // However, the ancestor filter requries specifying the exact tag used.
    // See: https://docs.docker.com/reference/cli/docker/container/ls/#ancestor
    execSync(`docker ps | awk '/minio/ { print $1 }' | xargs docker kill`);
    console.log(`
      @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
      @
      @ docker kill returned !
      @
      @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
    `);
    minioTerminated = true;
  }

  beforeEach(() => {
    if(minioTerminated) return;
  });

  afterEach(async function() {
    if(minioTerminated) return;

    this.timeout(TIMEOUT*2);

    await cli('reset-in-progress-to-pending');
    await cli('reset-failed-to-pending');

    await cli('upload-pending');
    previousBlobs = +await cli('count-blobs uploaded');
  });

  async function setup(testNumber) {
    attDir = `./test-forms/${testNumber}-attachments`;

    // given
    bigFileExists(attDir);
    expectedAttachments = fs.readdirSync(attDir).filter(f => !f.startsWith('.')).sort();
    api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword });
    projectId = await createProject();
    xmlFormId = await uploadFormWithAttachments(`./test-forms/${testNumber}.xml`, attDir);

    // when
    actualAttachments = await api.apiGet(`projects/${projectId}/forms/${xmlFormId}/attachments`);
    should.deepEqual(actualAttachments.map(a => a.name).sort(), expectedAttachments);

    // then
    should.equal(await cli('count-blobs pending'), expectedAttachments.length);
    should.equal(await cli('count-blobs uploaded'), previousBlobs);
    // and
    await assertNoneRedirect(actualAttachments);
  }

  it('should shift submission attachments to s3', async function() {
    this.timeout(TIMEOUT*2);

    // given
    await assertBlobStatuses({
      pending:     0,
      in_progress: 0,
      uploaded:    0,
      failed:      0,
    });
    await setup(1);
    await assertBlobStatuses({
      pending:    11,
      in_progress: 0,
      uploaded:    0,
      failed:      0,
    });

    // when
    await cli('upload-pending');

    // then
    await assertBlobStatuses({
      pending:     0,
      in_progress: 0,
      uploaded:   11,
      failed:      0,
    });
    // and
    await assertAllRedirect(actualAttachments);
    await assertAllDownloadsMatchOriginal(actualAttachments);
  });

  it('should continue to serve blobs while upload-pending is running', async function() {
    this.timeout(TIMEOUT*2);

    // given
    await setup(2);

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();

    // then
    const res = await api.apiRawGet(`projects/${projectId}/forms/${xmlFormId}/attachments/big.bin`);
    return assertDownloadMatchesOriginal(res, 'big.bin');

    // cleanup
    await uploading;
  });

  it('should gracefully handle simultaneous calls to upload-pending', async function() {
    this.timeout(TIMEOUT*2);

    // given
    await setup(3);

    // given
    const uploading1 = cli('upload-pending');
    const uploading2 = cli('upload-pending');

    // when
    const uploaded1 = hashes(await uploading1);
    const uploaded2 = hashes(await uploading2);

    // TODO Check how long each of the processes took to complete: ideally uploading1
    // should not block uploading2 and vice-versa.

    // then
    (uploaded1.length + uploaded2.length).should.equal(11);
    // and
    _.intersection(uploaded1, uploaded2).length.should.equal(0);
  });

  it('should gracefully handle upload-pending dying unexpectedly (SIGKILL)', async function() {
    this.timeout(TIMEOUT*2);

    // given
    const initialUploaded = previousBlobs;
    should.equal(await cli('count-blobs uploaded'), initialUploaded);
    await setup(4);
    should.equal(await cli('count-blobs uploaded'), initialUploaded);

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();
    // and
    await execSync(`kill -9 ${uploading.pid}`);

    // then
    await expectRejectionFrom(uploading);

    // then
    await assertBlobStatuses({
      pending:     1, // crashed process will roll back to pending
      in_progress: 0,
      uploaded:    initialUploaded,
      failed:      0,
    });
  });

  it('should gracefully handle upload-pending dying unexpectedly (SIGTERM)', async function() {
    this.timeout(TIMEOUT*2);

    // given
    const initialUploaded = previousBlobs;
    should.equal(await cli('count-blobs uploaded'), initialUploaded);
    await setup(5);
    should.equal(await cli('count-blobs uploaded'), initialUploaded);

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();
    // and
    await execSync(`kill ${uploading.pid}`);

    // then
    await expectRejectionFrom(uploading);

    // then
    await assertBlobStatuses({
      pending:     1, // crashed process will roll back to pending // TODO should we catch this & set to failed?
      in_progress: 0,
      uploaded:    initialUploaded,
      failed:      0,
    });
  });

  // ***N.B. THIS TEST KILLS THE MINIO SERVER, SO MUST BE RUN **LAST** OF ALL S3 E2E TESTS***
  it('should gracefully handle s3 connection failing', async function() {
    this.timeout(TIMEOUT*2);

    // given
    const initialUploaded = previousBlobs;
    await assertBlobStatuses({
      pending:     0,
      in_progress: 0, // crashed process will be stuck in_progress forever TODO decide if this is acceptable
      uploaded:    initialUploaded,
      failed:      0,
    });
    await setup(6);
    await assertBlobStatuses({
      pending:     1,
      in_progress: 0, // crashed process will be stuck in_progress forever TODO decide if this is acceptable
      uploaded:    initialUploaded,
      failed:      0,
    });

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();
    // and
    terminateMinio();
    // and
    const stdo = await uploading; // should exit cleanly, after ~90s timeout

    console.log('stdo:', stdo);

    // then
    stdo.should.match(/Caught error: (AggregateError\n.*)?Error: connect ECONNREFUSED/s); // weird error, but seems consistent - presumably this is the last error seen after repeated retries
    // and
    await assertBlobStatuses({
      pending:     0,
      in_progress: 0, // crashed process will be stuck in_progress forever TODO decide if this is acceptable
      uploaded:    initialUploaded,
      failed:      1,
    });
  });

  // TODO add a test for when s3 is ALREADY DOWN

  async function untilUploadInProgress() {
    while(await cli('count-blobs in_progress') !== '1') { sleep(10); }
  }

  async function assertBlobStatuses(expected) {
    const counts = await countAllByStatus();
    counts.should.deepEqual(expected);
  }

  async function countAllByStatus() {
    // For easier debugging, define keys up-front.  This makes print order more predictable.
    const counts = { pending:null, in_progress:null, uploaded:null, failed:null };
    await Promise.all(Object.keys(counts).map(async status => {
      counts[status] = Number(await cli(`count-blobs ${status}`));
    }));
    return counts;
  }

  async function createProject() {
    const project = await api.apiPostJson(
      'projects',
      { name:`s3-test-${new Date().toISOString().replace(/\..*/, '')}` },
    );
    return project.id;
  }

  async function uploadFormWithAttachments(xmlFilePath, attDir) {
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

  function bigFileExists() {
    const bigFile = `${attDir}/big.bin`;
    if(fs.existsSync(bigFile)) {
      log.info('big.bin exists; skipping generation');
    } else {
      log.info('Generating big.bin...');
      let remaining = 100000000; // FIXME when tests are all passing locally and CI, this can probably be decreased
      const batchSize = 100000;
      do {
        fs.appendFileSync(bigFile, randomBytes(batchSize));
      } while((remaining-=batchSize) > 0);
    }
  }
});

function cli(cmd) {
  let pid;

  cmd = `exec node lib/bin/s3 ${cmd}`;
  log.info('cli()', 'calling:', cmd);
  const env = { ..._.pick(process.env, 'PATH'), NODE_CONFIG_ENV:'s3-dev' };

  const promise = new Promise((resolve, reject) => {
    const child = exec(cmd, { env, cwd:'../../..' }, (err, stdout) => {
      if (err) return reject(err);

      const res = stdout.toString().trim();
      log.info('cli()', 'returned:', res);
      resolve(res);
    });
    pid = child.pid;
  });

  promise.pid = pid;

  return promise;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hashes(uploadOutput) {
  const leader = 'Uploading blob:';
  const hashes = uploadOutput.trim()
    .split('\n')
    .filter(line => line.startsWith(leader))
    .map(line => JSON.parse(line.substr(leader.length)).sha);
  console.log({ uploadOutput, hashes });
  return hashes;
}

async function expectRejectionFrom(promise) {
  try {
    await promise;
    should.fail('Uploading should have exited with non-zero status.');
  } catch(err) {
    if(err.message.startsWith('Command failed: exec node lib/bin/s3 ')) {
      // expected
    } else {
      throw err;
    }
  }
}
