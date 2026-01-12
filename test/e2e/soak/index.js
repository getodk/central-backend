// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const fs = require('node:fs');
const _ = require('lodash');
const { v4: uuid } = require('uuid');
const { program } = require('commander');

const SUITE_NAME = 'test/e2e/soak';
const log = require('../util/logger')(SUITE_NAME);
const { apiClient } = require('../util/api');

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8989')
    .option('-u, --user-email <userEmail>', 'Email of central user', 'x@example.com')
    .option('-P, --user-password <userPassword>', 'Password of central user', 'secret')
    .option('-f, --form-path <formPath>', 'Path to form file (XML, XLS, XLSX etc.)', './250q-form.xml')
    .option('-L, --log-directory <log-directory>', 'Log output directory (this should be an empty or non-existent directory)')
    ;
program.parse();
const { serverUrl, userEmail, userPassword, formPath, logDirectory } = program.opts();

const submissionTemplate = fs.readFileSync('./250q-submission.template.xml', { encoding:'utf8' }).trim();

log(`Using form: ${formPath}`);
log(`Connecting to ${serverUrl} with user ${userEmail}...`);

const logPath = logDirectory || `./logs/${new Date().toISOString()}`;

let api;

soakTest();

async function soakTest() {
  log.info('Setting up...');

  log.info('Creating log directory:', logPath, '...');
  fs.mkdirSync(logPath, { recursive:true });

  api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword, logPath });

  log.info('Creating project...');
  const { id:projectId } = await api.apiPostJson('projects', { name:`soak-test-${new Date().toISOString().replace(/\..*/, '')}` });

  log.info('Uploading form...');
  const { xmlFormId:formId } = await api.apiPostFile(`projects/${projectId}/forms`, formPath);

  log.info('Publishing form...');
  await api.apiPost(`projects/${projectId}/forms/${formId}/draft/publish`);

  log.info('Setup complete.  Starting soak tests...');

  await doSoakTest('randomSubmission', 50, 1_000, 30_000, 100, n => randomSubmission(n, projectId, formId));

  // TODO work out a more scientific sleep duration
  const backgroundJobPause = 20_000;
  log.info(`Sleeping ${durationForHumans(backgroundJobPause)} to allow central-backend to complete background jobs...`);
  await new Promise(resolve => { setTimeout(resolve, backgroundJobPause); });
  log.info('Woke up.');

  await doSoakTest('exportZipWithDataAndMedia', 10, 3_000, 300_000, 0, n => exportZipWithDataAndMedia(n, projectId, formId));

  log.info(`Check for extra logs at ${logPath}`);

  log.info('Complete.');

  // force exit in case some promise somewhere has failed to resolved (somehow required in Github Actions)
  process.exit(0);
}

function doSoakTest(name, throughput, throughputPeriod, testDuration, minimumSuccessThreshold, fn) {
  log.info('Starting soak test:', name);
  log.info('        throughput:', throughput, 'per period');
  log.info('  throughputPeriod:', throughputPeriod, 'ms');
  log.info('      testDuration:', durationForHumans(testDuration));
  log.info('-------------------------------');
  return new Promise((resolve, reject) => {
    try {
      const successes = [];
      const sizes = [];
      const fails = [];
      const results = [];
      const sleepyTime = +throughputPeriod / +throughput;

      let iterationCount = 0;
      let completedIterations = 0;
      const iterate = async () => {
        const n = iterationCount++;
        const started = Date.now();
        try {
          const size = await fn(n);
          const finished = Date.now();
          const time = finished - started;
          successes.push(time);
          sizes.push(size);
          results[n] = { success:true,  started, finished, time, size };
        } catch(err) {
          fails.push(err.message);
          results[n] = { success:false, started, finished:Date.now(), err:{ message:err.message, stack:err.stack } };
        } finally {
          ++completedIterations;
        }
      };

      iterate();
      const timerId = setInterval(iterate, sleepyTime);

      setTimeout(async () => {
        clearTimeout(timerId);

        const maxDrainDuration = 120_000;
        await new Promise(resolve => {
          log.info(`Waiting up to ${durationForHumans(maxDrainDuration)} for test drainage...`);
          const maxDrainTimeout = Date.now() + maxDrainDuration;
          const drainPulse = 500;

          checkDrain();

          function checkDrain() {
            log.debug('Checking drain status...');
            if(Date.now() > maxDrainTimeout) {
              log.info('Drain timeout exceeded.');
              return resolve();
            } else if(completedIterations >= iterationCount) {
              log.info('All connections have completed.');
              return resolve();
            }
            log.debug(`Drainage not complete.  Still Waiting for ${iterationCount - results.length} connections.  Sleeping for ${durationForHumans(drainPulse)}...`);
            setTimeout(checkDrain, drainPulse);
          }
        });

        fs.writeFileSync(`${logPath}/${name}.extras.log.json`, JSON.stringify(results, null, 2));

        const successPercent = 100 * successes.length / iterationCount;

        log.report('--------------------------');
        log.report('              Test:', name);
        log.report('     Test duration:', testDuration);
        log.report('    Total requests:', iterationCount);
        log.report('Success % required:', `${minimumSuccessThreshold}%`);
        log.report('         Successes:', successes.length, `(${Math.floor(successPercent)}%)`);
        log.report('        Throughput:', oneDp((1000 * successes.length / testDuration)), 'reqs/s');
        log.report('          Failures:', fails.length);
        log.report('    Response times:');
        log.report('              mean:', durationForHumans(_.mean(successes)));
        log.report('               min:', _.min(successes), 'ms');
        log.report('               max:', _.max(successes), 'ms');
        log.report('    Response sizes:');
        log.report('               min:', _.min(sizes), 'b');
        log.report('               max:', _.max(sizes), 'b');
        if(fails.length) log.report('            Errors:');
        [ ...new Set(fails) ].map(m => log.report(`              * ${m.replace(/\n/g, '\\n')}`));
        log.report('--------------------------');

        if(_.min(sizes) !== _.max(sizes)) reportFatalError('VARIATION IN RESPONSE SIZES MAY INDICATE SERIOUS ERRORS SERVER-SIDE');

        if(successPercent < minimumSuccessThreshold) reportFatalError('MINIMUM SUCCESS THRESHOLD WAS NOT MET');

        if(fails.length) reportWarning('REQUEST FAILURES MAY AFFECT SUBSEQUENT SOAK TESTS');

        resolve();
      }, +testDuration);
    } catch(err) {
      reject(err);
    }
  });
}

function reportFatalError(message) {
  reportWarning(message);
  process.exit(1);
}

function reportWarning(message) {
  log.report('!!!');
  log.report('!!!');
  log.report(`!!! ${message}!`);
  log.report('!!!');
  log.report('!!!');
  log.report('--------------------------');
}

function randomSubmission(n, projectId, formId) {
  const headers = {
    'Content-Type': 'multipart/form-data; boundary=foo',
    'X-OpenRosa-Version': '1.0',
  };

  const body = `--foo\r
Content-Disposition: form-data; name="xml_submission_file"; filename="submission.xml"\r
Content-Type: application/xml\r
\r
${submissionTemplate
  .replace(/{{uuid}}/g, () => uuid())
  .replace(/{{randInt}}/g, randInt)
}
\r
--foo--`;

  return api.apiPostAndDump('randomSubmission', n, `projects/${projectId}/forms/${formId}/submissions`, body, headers);
}

function randInt() {
  return Math.floor(Math.random() * 9999);
}

function exportZipWithDataAndMedia(n, projectId, formId) {
  return api.apiGetToFile('exportZipWithDataAndMedia', n, `projects/${projectId}/forms/${formId}/submissions.csv.zip?splitSelectMultiples=true&groupPaths=true&deletedFields=true`);
}

function durationForHumans(ms) {
  if(ms > 1000) return oneDp((ms / 1000)) + 's';
  else          return oneDp(         ms) + 'ms';
}

function oneDp(n) {
  return Number(n.toFixed(1));
}
