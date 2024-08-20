// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable func-names, no-await-in-loop, space-before-function-paren  */

// Enough time to upload big.bin, and then run each test scenario.
const TIMEOUT = 120_000; // ms

const { exec, execSync } = require('node:child_process');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const _ = require('lodash');
const should = require('should');

const SUITE_NAME = 'test/e2e/s3';
const log = require('../util/logger')(SUITE_NAME);
const { apiClient, mimetypeFor, Redirect } = require('../util/api');

const serverUrl = 'http://localhost:8383';
const userEmail = 'x@example.com';
const userPassword = 'secret1234';

describe('s3 support', () => {
  // eslint-disable-next-line one-var, one-var-declaration-per-line
  let api, expectedAttachments, actualAttachments, projectId, xmlFormId, attDir;
  let _initial, _minioTerminated; // eslint-disable-line one-var, one-var-declaration-per-line

  const minioTerminated = () => {
    if(_minioTerminated) return;

    // It should be possible to use docker more precisely here, e.g.
    //   docker stop $(docker ps --quiet --filter "ancestor=minio/minio")
    // However, the ancestor filter requries specifying the exact tag used.
    // See: https://docs.docker.com/reference/cli/docker/container/ls/#ancestor
    execSync(`docker ps | awk '/minio/ { print $1 }' | xargs docker kill`);
    _minioTerminated = true;
  };

  beforeEach(async function() {
    this.timeout(5000);
    _initial = await countAllByStatus();
  });

  afterEach(async function() {
    if(_minioTerminated) return;

    this.timeout(TIMEOUT);
    await cli('reset-failed-to-pending');
    await cli('upload-pending');
  });

  async function setup(testNumber, opts={ bigFile: true }) {
    attDir = `./test-forms/${testNumber}-attachments`;

    // given
    if(opts.bigFile) bigFileExists(attDir);
    expectedAttachments = fs.readdirSync(attDir).filter(f => !f.startsWith('.')).sort();
    api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword });
    projectId = await createProject();
    xmlFormId = await uploadFormWithAttachments(`./test-forms/${testNumber}.xml`, attDir);

    // when
    actualAttachments = await api.apiGet(`projects/${projectId}/forms/${xmlFormId}/attachments`);
    should.deepEqual(actualAttachments.map(a => a.name).sort(), expectedAttachments);

    // then
    await assertNewStatuses({ pending: expectedAttachments.length });
    // and
    await assertNoneRedirect(actualAttachments);
  }

  it('should shift submission attachments to s3', async function() {
    this.timeout(TIMEOUT);

    // given
    await setup(1);
    await assertNewStatuses({ pending: 11 });

    // when
    await cli('upload-pending');

    // then
    await assertNewStatuses({ uploaded: 11 });
    // and
    await assertAllRedirect(actualAttachments);
    await assertAllDownloadsMatchOriginal(actualAttachments);
  });

  it('should continue to serve blobs while upload-pending is running', async function() {
    this.timeout(TIMEOUT);

    // given
    await setup(2);

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();

    // then
    const res = await api.apiRawGet(`projects/${projectId}/forms/${xmlFormId}/attachments/big.bin`);
    await assertDownloadMatchesOriginal(res, 'big.bin');

    // cleanup
    await uploading;
  });

  it('should gracefully handle simultaneous calls to upload-pending', async function() {
    this.timeout(TIMEOUT);

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
    this.timeout(TIMEOUT);

    // given
    await setup(4);
    await assertNewStatuses({ pending: 1 });

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();
    // and
    await execSync(`kill -9 ${uploading.pid}`);

    // then
    await expectRejectionFrom(uploading);

    // then
    await assertNewStatuses({ pending: 1 }); // crashed process will roll back to pending
  });

  // TODO Also test SIGINT?
  it('should gracefully handle upload-pending dying unexpectedly (SIGTERM)', async function() {
    this.timeout(TIMEOUT);

    // given
    await setup(5);
    assertNewStatuses({ pending: 1 });

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();
    // and
    await execSync(`kill ${uploading.pid}`);

    // then
    await expectRejectionFrom(uploading);

    // then
    await assertNewStatuses({ pending: 1 }); // crashed process will roll back to pending // TODO should we catch this & set to failed?
  });

  // N.B. THIS TEST KILLS THE MINIO SERVER, SO IT WILL NOT BE AVAILABLE TO SUBSEQUENT TESTS
  it('should handle s3 connection failing', async function() {
    this.timeout(TIMEOUT);

    // given
    // TODO test transaction boundaries are correct by adding a second attachment and making sure it uploads successfully before killing the server
    await setup(6);
    await assertNewStatuses({ pending: 1 });

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();
    // and
    minioTerminated();

    // then
    // N.B. These errors are as observed, and demonstrate that the root error is shared
    // with the user.  They are not something to try to retain if implementation changes.
    await expectRejectionFrom(uploading, new RegExp(
      'Command failed: exec node lib/bin/s3 upload-pending\n' +
          '(AggregateError\n.*)?Error: (connect ECONNREFUSED|read ECONNRESET|socket hang up)',
      's',
    ));
    // and
    await assertNewStatuses({ failed: 1 });
  });

  it('should handle s3 unavailable', async function() {
    this.timeout(TIMEOUT);

    // given
    minioTerminated();
    // and
    await setup(7, { bigFile: false });
    // TODO add another 1+ attachments here to demonstrate that ONE is marked failed, and the others are still pending
    await assertNewStatuses({ pending: 1 });

    // when
    await expectRejectionFrom(cli('upload-pending'), /Error: connect ECONNREFUSED/);

    // then
    await assertNewStatuses({ failed: 1 });
  });

  async function untilUploadInProgress() {
    while(await cli('count-blobs in_progress') !== '1') { sleep(10); }
  }

  async function assertNewStatuses(expected) {
    const counts = await countAllByStatus();
    counts.should.deepEqual({
      pending:     _initial.pending     + (expected.pending     ?? 0),
      in_progress: _initial.in_progress + (expected.in_progress ?? 0),
      uploaded:    _initial.uploaded    + (expected.uploaded    ?? 0),
      failed:      _initial.failed      + (expected.failed      ?? 0),
    });
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
      await assertDownloadMatchesOriginal(res2, att.name);
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
      // big.bin needs to take long enough to upload that the tests can
      // intervene with the upload in various ways.  Uploading a file of 100
      // million bytes was timed to take the following:
      //
      //   * on github actions: 1.2-1.6s
      //   * locally:           300ms-7s
      let remaining = 100_000_000;
      const batchSize = 100_000;
      do {
        fs.appendFileSync(bigFile, randomBytes(batchSize));
      } while((remaining-=batchSize) > 0); // eslint-disable-line no-cond-assign
    }
  }
});

function cli(cmd) {
  let pid;

  cmd = `exec node lib/bin/s3 ${cmd}`; // eslint-disable-line no-param-reassign
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
  return new Promise(resolve => { setTimeout(resolve, ms); });
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

async function expectRejectionFrom(promise, expectedMessage) {
  try {
    await promise;
    should.fail('Uploading should have exited with non-zero status.');
  } catch(err) {
    if(err.message.startsWith('Command failed: exec node lib/bin/s3 ')) {
      // expected
      if(expectedMessage) err.message.should.match(expectedMessage);
    } else {
      throw err;
    }
  }
}
