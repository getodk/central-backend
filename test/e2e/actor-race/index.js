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
const uuid = require('uuid').v4;
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

  const execId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  log.info('Creating log directory:', logPath, '...');
  fs.mkdirSync(logPath, { recursive:true });

  api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword, logPath });

  const roles = await api.apiGet('roles');
  console.log('roles:', roles);
  const roleIds = roles
      .filter(r => !['admin', 'pwreset', 'pub-link'].includes(r.system))
      .map(r => r.id);
  console.log('roleIds:', roleIds);

  const initialCount = await dbCount(`SELECT COUNT(*) FROM actors AS count`);
  log.info('initialCount:', initialCount);

  const actorCount = 10;

  // TODO create a load of Actors
  const actorCreations = [];
  for(let i=0; i<actorCount; ++i) {
    const uniq = `condemned-actor-${execId}-${i}`;
    const creation = api
        .apiPostJson('users', {
          email: `condemned-actor-${execId}-${i}@example.test`,
          password: uniq,
        })
        .then(res => res.id);
    actorCreations.push(creation);
  }
  const actors = await Promise.all(actorCreations);
  console.log('actors:', actors);

  const finalCount = await dbCount(`SELECT COUNT(*) FROM actors AS count`);
  log.info('finalCount:', finalCount);

  const createdCount = finalCount - initialCount;
  if(createdCount !== actorCount) throw new Error(`Expected ${actorCount} actors, but got ${createdCount}`);

  // TODO simultaneously:
  // * TODO assign all the roles to all the actors
  // * TODO delete all the actors
  await Promise.all(actors.flatMap(id => [
    ...roleIds.map(roleId => withRandomDelay(async () => {
      try {
        return await api.apiPost(`assignments/${roleId}/${id}`);
      } catch(err) {
        if(err.responseStatus !== 404) throw err;
      }
    })),
    withRandomDelay(() => api.apiDelete(`users/${id}`)),
  ]));

  // TODO check for assignments to deleted actors
  const count = await countAssignedButDeletedActors();
  if(count !== 0) throw new Error(`There are ${count} assignments for deleted actors.`);

  log.info(`Check for extra logs at ${logPath}`);

  log.info('Complete.');

  // force exit in case some promise somewhere has failed to resolved (somehow required in Github Actions)
  process.exit(0);
}

async function dbQuery(sqlQuery) {
  const client = new (require('pg').Client)(require('../../../config/default').default.database);
  await client.connect();

  const { rows } = await client.query(sqlQuery);

  return rows;
}

async function withRandomDelay(fn) {
  await sleep(randInt(10));
  return fn();
}

async function dbCount(sqlQuery) {
  const [ { count } ] = await dbQuery(sqlQuery);
  return +count;
}

async function countAssignedButDeletedActors() {
  return await dbCount(`
    SELECT COUNT(*) AS count
      FROM assignments
      JOIN actors AS actors ON actors.id=assignments."actorId"
      WHERE actors."deletedAt" IS NOT NULL
  `);
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

function randInt(max=9999) {
  return Math.floor(Math.random() * max);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
