// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable func-names, no-await-in-loop, space-before-function-paren  */

// Enough time to upload big-*.bin, and then run each test scenario.
const TIMEOUT = 240_000; // ms

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

  async function setup(testNumber, opts={}) {
    // Bigger bigfiles decrease the likelihood of tests flake due to race
    // conditions.  However, bigger files also make for slower tests, and the
    // max bigfile size is limited by a bug in node-pg.
    // See: https://github.com/brianc/node-postgres/issues/2653
    const { // eslint-disable-line object-curly-newline
      bigFiles = 1,
      bigFileSizeMb = 100,
    } = opts; // eslint-disable-line object-curly-newline

    attDir = `./test-forms/${testNumber}-attachments`;

    // given
    fs.mkdirSync(attDir, { recursive:true });
    for(let idx=0; idx<bigFiles; ++idx) bigFileExists(attDir, bigFileSizeMb, 1+idx);
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
    await assertNewStatuses({ pending: 13 });

    // when
    await cli('upload-pending');

    // then
    await assertNewStatuses({ uploaded: 13 });
    // and
    await assertAllRedirect(actualAttachments);
    await assertAllDownloadsMatchOriginal(actualAttachments);
  });

  it('should continue to serve blobs while upload-pending is running', async function() {
    this.timeout(TIMEOUT);

    // given
    await setup(2);
    await assertNewStatuses({ pending: 1 });

    // when
    const uploading = cli('upload-pending');
    await untilUploadInProgress();

    // then
    const res = await api.apiRawGet(`projects/${projectId}/forms/${xmlFormId}/attachments/big-1.bin`);
    await assertDownloadMatchesOriginal(res, 'big-1.bin');

    // cleanup
    await uploading;
  });

  it('should gracefully handle simultaneous calls to upload-pending', async function() {
    this.timeout(TIMEOUT);

    const uploadPending = async () => {
      const start = performance.now();
      const stdout = await cli('upload-pending');
      const duration = performance.now() - start;
      const parsedHashes = hashes(stdout);
      return { hashes:parsedHashes, duration };
    };

    // given
    await setup(3);
    await assertNewStatuses({ pending: 11 });

    // given
    const uploading1 = uploadPending();
    const uploading2 = uploadPending();

    // when
    const res1 = await uploading1;
    const res2 = await uploading2;

    // then
    await assertNewStatuses({ uploaded: 11 });
    // and
    (res1.hashes.length + res2.hashes.length).should.equal(11);
    // and
    _.intersection(res1.hashes, res2.hashes).length.should.equal(0);
    // and
    Math.abs(res1.duration - res2.duration).should.be.above(1_000,
        'UPLOAD DURATIONS TOO SIMILAR!  ' +
        'There is no guarantee of which call to upload-pending got big-1.bin, ' +
        `but similar durations for uploading1 (${humanDuration(res1)}) and ` +
        `uploading2 (${humanDuration(res2)}) implies that one was blocking the other.`);
  });

  it('should gracefully handle upload-pending dying unexpectedly (SIGKILL)', async function() {
    this.timeout(TIMEOUT);

    // given
    await setup(4);
    await assertNewStatuses({ pending: 1 });

    // when
    const uploading = forSacrifice(cli('upload-pending'));
    await untilUploadInProgress();
    // and
    await execSync(`kill -9 ${uploading.pid}`);

    // then
    await expectRejectionFrom(uploading);

    // then
    await assertNewStatuses({ pending: 1 }); // crashed process will roll back to pending
  });

  describe('should gracefully handle upload dying unexpectedly', () => {
    const randomSignal = () => (Math.random() < 0.5 ? 'SIGTERM' : 'SIGINT');
    const randomSignals = length => Array.from({ length }, randomSignal);

    const formXmlTemplate = fs.readFileSync('./test-forms/5-template.xml', 'utf8');
    const generateFormXml = testIdx => {
      const formXmlPath = `./test-forms/5-${testIdx}.xml`;
      fs.writeFileSync(
        formXmlPath,
        formXmlTemplate.replace(/\{\{testIdx\}\}/gm, testIdx),
      );
    };

    [
      [ 'SIGTERM' ],
      [ 'SIGINT' ],

      // Every iteration of this test takes 6+ seconds, so instead of running
      // a full set of combinations of signals for 2 & 3 sequential signals,
      // generate a few random datasets:
      randomSignals(2),
      randomSignals(3),
      randomSignals(4),
    ].forEach((signals, testIdx) => {
      it(`Test #${testIdx}: signals [${signals}]`, async function() {
        this.timeout(TIMEOUT);

        // given
        log('Generating form xml...');
        generateFormXml(testIdx);
        // and
        log('Setting up test...');
        await setup(`5-${testIdx}`);
        log('Checking 1 new attachment is pending...');
        await assertNewStatuses({ pending: 1 });

        // when
        log('Starting upload...');
        const uploading = forSacrifice(cli('upload-pending'));
        log('Waiting for upload to start...');
        await untilUploadInProgress();
        // and
        log('Sending signals...');
        for(const s of signals) {
          switch(s) {
            case 'SIGINT':  execSync(`kill -2 ${uploading.pid}`); break;
            case 'SIGTERM': execSync(`kill    ${uploading.pid}`); break;
            default: throw new Error(`No handling for signal '${s}'`);
          }
        }

        // then
        await expectRejectionFrom(uploading);

        // then
        await assertNewStatuses({ failed: 1 });
      });
    });
  });

  // N.B. THIS TEST KILLS THE MINIO SERVER, SO IT WILL NOT BE AVAILABLE TO SUBSEQUENT TESTS
  it('should handle s3 connection failing', async function() {
    this.timeout(TIMEOUT);

    // This also tests transaction boundaries are correct by adding two attachments,
    // and making sure the first uploads successfully before killing the server.

    // given
    await setup(6, { bigFiles: 2, bigFileSizeMb: 250 });
    await assertNewStatuses({ pending: 2 });

    // when
    const uploading = forSacrifice(cli('upload-pending'));
    while(true) { // eslint-disable-line no-constant-condition
      const uploaded = await countByNewStatus('uploaded');
      if(uploaded === 0) {
        await tick();
        continue;
      }
      if(uploaded === 1) break;
      else should.fail('Too many blobs uploaded already!');
    }
    await untilUploadInProgress();
    // and
    minioTerminated();

    // then
    // N.B. These errors are as observed, and demonstrate that the root error is shared
    // with the user.  They are not something to try to retain if implementation changes.
    await expectRejectionFrom(uploading, /(AggregateError.*)?Error: (connect ECONNREFUSED|read ECONNRESET|socket hang up|write EPIPE)/);
    // and
    await assertNewStatuses({ uploaded: 1, failed: 1 });
  });

  it('should handle s3 unavailable', async function() {
    this.timeout(TIMEOUT);

    // given
    minioTerminated();
    // and
    await setup(7, { bigFiles: 0 });
    await assertNewStatuses({ pending: 2 });

    // when
    await expectRejectionFrom(forSacrifice(cli('upload-pending')), /Error: connect ECONNREFUSED/);

    // then
    await assertNewStatuses({ pending: 1, failed: 1 });
  });

  // Guard against a Promise resolving when it was expected to reject.  This has
  // specifically been seen when upload-pending returns immediately, but later
  // test code is expecting it to spend time uploading.  In those cases, this
  // wrapper allows for faster failure - without this short-circuit, the test
  // would have to wait for the maximum timeout duration.
  function forSacrifice(cliPromise) {
    const wrapper = cliPromise.then(res => {
      // TODO there may be a more idiomatic way to quickly fail the test from
      // within mocha, but this achieves the desired result:
      console.log(new Error(`FATAL ERROR: promise should have failed, but it resolved successfully with: <${res}>`));
      process.exit(1);
    });
    wrapper.pid = cliPromise.pid;
    return wrapper;
  }

  async function untilUploadInProgress() {
    while(await countByStatus('in_progress') !== 1) await tick();
  }

  // Yield control of the event loop to other functions which are waiting.
  function tick() {
    return new Promise(resolve => { setImmediate(resolve); });
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

  async function countByNewStatus(status) {
    const current = await countByStatus(status);
    return current - _initial[status];
  }

  async function countByStatus(status) {
    return Number(await cli(`count-blobs ${status}`));
  }

  async function countAllByStatus() {
    // For easier debugging, define keys up-front.  This makes print order more predictable.
    const counts = { pending:null, in_progress:null, uploaded:null, failed:null };
    await Promise.all(Object.keys(counts).map(async status => {
      counts[status] = await countByStatus(status);
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
      log.debug('assertNoneRedirect()', 'checking attachment:', att.name);
      const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
      should.ok(!(res instanceof Redirect), `${att.name} is a redirect!`);
      should.equal(res.status, 200);
      log.debug('assertNoneRedirect()', '  Looks OK.');
    }
  }

  async function assertAllRedirect(attachments) {
    for(const att of attachments) {
      log.debug('assertAllRedirect()', 'checking attachment:', att.name);
      const res = await api.apiRawHead(`projects/${projectId}/forms/${xmlFormId}/attachments/${att.name}`);
      should.ok(res instanceof Redirect, `${att.name} is not a redirect - returned HTTP status: ${res.status}`);
      log.debug('assertAllRedirect()', '  Looks OK.');
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

    const expectedContentType = mimetypeFor(name) ?? 'application/octet-stream';

    const actualContentType = res.headers.get('content-type');
    should.equal(actualContentType, expectedContentType);

    const resContent = new Uint8Array(await res.arrayBuffer());
    const fileContent = fs.readFileSync(filepath);
    should.equal(resContent.length, fileContent.length);

    // Comparing streams might be faster; this is acceptably fast at the moment.
    for(let i=0; i<fileContent.length; ++i) {
      should.equal(resContent[i], fileContent[i]);
    }
    log.debug('assertDownloadMatchesOriginal()', '  Looks OK.');
  }
});

function cli(cmd) {
  let pid;

  cmd = `exec node lib/bin/s3 ${cmd}`; // eslint-disable-line no-param-reassign
  log.debug('cli()', 'calling:', cmd);
  const env = { ..._.pick(process.env, 'PATH'), NODE_CONFIG_ENV:'s3-dev' };

  const promise = new Promise((resolve, reject) => {
    const child = exec(cmd, { env, cwd:'../../..' }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout; // eslint-disable-line no-param-reassign
        err.stderr = stderr; // eslint-disable-line no-param-reassign
        return reject(err);
      }

      const res = stdout.toString().trim();
      log.debug('cli()', cmd, 'returned:', res);
      resolve(res);
    });
    pid = child.pid;
  });

  promise.pid = pid;

  return promise;
}

function hashes(uploadOutput) {
  const leader = 'Uploading blob:';
  const hashes = uploadOutput.trim()
    .split('\n')
    .filter(line => line.startsWith(leader))
    .map(line => JSON.parse(line.substr(leader.length)).sha);
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

function humanDuration({ duration }) {
  return (duration / 1000).toFixed(3) + 's';
}

function bigFileExists(attDir, sizeMb, idx) {
  const bigFile = `${attDir}/big-${idx}.bin`;
  if(fs.existsSync(bigFile)) {
    log.debug(`${bigFile} exists; skipping generation`);
  } else {
    log.debug(`Generating ${bigFile}...`);
    // Big bin files need to take long enough to upload that the tests can
    // intervene with the upload in various ways.  Uploading a file of 100
    // million bytes was timed to take the following:
    //
    //   * on github actions: 1.2-1.6s
    //   * locally:           300ms-7s
    let remaining = sizeMb * 1_000_000;
    const batchSize = 100_000;
    do {
      fs.appendFileSync(bigFile, randomBytes(batchSize));
    } while((remaining-=batchSize) > 0); // eslint-disable-line no-cond-assign
  }
}
