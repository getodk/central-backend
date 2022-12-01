// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

import fs from 'node:fs';
import fetch, { fileFromSync } from 'node-fetch';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { basename } from 'node:path';
import { program } from 'commander';

const _log = (...args) => console.log(`[${new Date().toISOString()}]`, '[soak-tester]', ...args);
const log  = (...args) => true  && _log('INFO',   ...args);
log.debug  = (...args) => false && _log('DEBUG',  ...args);
log.info   = log;
log.error  = (...args) => true  && _log('ERROR',  ...args);
log.report = (...args) => true  && _log('REPORT', ...args);

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8989')
    .option('-u, --user-email <serverUrl>', 'Email of central user', 'x@example.com')
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

let bearerToken;

soakTest();

async function soakTest() {
  log.info('Setting up...');

  log.info('Creating log directory:', logPath, '...');
  fs.mkdirSync(logPath, { recursive:true });

  log.info('Creating session...');
  const { token } = await apiPostJson('sessions', { email:userEmail, password:userPassword }, { Authorization:null });
  bearerToken = token;

  log.info('Creating project...');
  const { id:projectId } = await apiPostJson('projects', { name:`soak-test-${new Date().toISOString().replace(/\..*/, '')}` });

  log.info('Uploading form...');
  const { xmlFormId:formId } = await apiPostFile(`projects/${projectId}/forms`, formPath);

  log.info('Publishing form...');
  await apiPost(`projects/${projectId}/forms/${formId}/draft/publish`);

  log.info('Setup complete.  Starting soak tests...');

  await doSoakTest('randomSubmission', 50, 1_000, 30_000, 100, n => randomSubmission(n, projectId, formId));

  // TODO work out a more scientific sleep duration
  const backgroundJobPause = 20_000;
  log.info(`Sleeping ${durationForHumans(backgroundJobPause)} to allow central-backend to complete background jobs...`);
  await new Promise(resolve => setTimeout(resolve, backgroundJobPause));
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

function apiPostFile(path, filePath) {
  const mimeType = mimetypeFor(filePath);
  const blob = fileFromSync(filePath, mimeType);
  return apiPost(path, blob, { 'Content-Type':mimeType });
}

function apiPostJson(path, body, headers) {
  return apiPost(path, JSON.stringify(body), { 'Content-Type':'application/json', ...headers });
}

function apiGetAndDump(prefix, n, path, headers) {
  return fetchToFile(prefix, n, 'GET', path, undefined, headers);
}

function apiPostAndDump(prefix, n, path, body, headers) {
  return fetchToFile(prefix, n, 'POST', path, body, headers);
}

async function fetchToFile(filenamePrefix, n, method, path, body, headers) {
  const res = await apiFetch(method, path, body, headers);

  return new Promise((resolve, reject) => {
    try {
      let bytes = 0;
      res.body.on('data', data => bytes += data.length);
      res.body.on('error', reject);

      const file = fs.createWriteStream(`${logPath}/${filenamePrefix}.${n.toString().padStart(9, '0')}.dump`);
      res.body.on('end', () => file.close(() => resolve(bytes)));

      file.on('error', reject);

      res.body.pipe(file);
    } catch(err) {
      console.log(err);
      process.exit(99);
    }
  });
}

async function apiPost(path, body, headers) {
  const res = await apiFetch('POST', path, body, headers);
  return res.json();
}

async function apiFetch(method, path, body, headers) {
  const url = `${serverUrl}/v1/${path}`;

  const Authorization = bearerToken ? `Bearer ${bearerToken}` : `Basic ${base64(`${userEmail}:${userPassword}`)}`;

  const res = await fetch(url, {
    method,
    body,
    headers: { Authorization, ...headers },
  });
  log.debug(method, res.url, '->', res.status);
  if(!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}

function mimetypeFor(f) {
  const extension = fileExtensionFrom(f);
  log.debug('fileExtensionFrom()', f, '->', extension);
  switch(extension) {
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

  return apiPostAndDump('randomSubmission', n, `projects/${projectId}/forms/${formId}/submissions`, body, headers);
}

function randInt() {
  return Math.floor(Math.random() * 9999);
}

function exportZipWithDataAndMedia(n, projectId, formId) {
  return apiGetAndDump('exportZipWithDataAndMedia', n, `projects/${projectId}/forms/${formId}/submissions.csv.zip?splitSelectMultiples=true&groupPaths=true&deletedFields=true`);
}

function durationForHumans(ms) {
  if(ms > 1000) return oneDp((ms / 1000)) + 's';
  else          return oneDp(         ms) + 'ms';
}

function oneDp(n) {
  return Number(n.toFixed(1));
}
