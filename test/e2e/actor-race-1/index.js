// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const fs = require('node:fs');
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

  // simultaneously:
  // * assign all the roles to all the actors
  // * delete all the actors
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

  // check for assignments to deleted actors
  const count = await countAssignedButDeletedActors();
  if(count !== 0) throw new Error(`There are ${count} assignments for deleted actors.`);

  log.info(`Check for extra logs at ${logPath}`);

  log.info('Complete.');

  // force exit in case some promise somewhere has failed to resolved (somehow required in Github Actions)
  process.exit(0);
}

async function dbQuery(sqlQuery) {
  const client = new (require('pg').Client)(require('../../../config/default.json').default.database);
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

function countAssignedButDeletedActors() {
  return dbCount(`
    SELECT COUNT(*) AS count
      FROM assignments
      JOIN actors AS actors ON actors.id=assignments."actorId"
      WHERE actors."deletedAt" IS NOT NULL
  `);
}

function randInt(max=9999) {
  return Math.floor(Math.random() * max);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms)); // eslint-disable-line no-promise-executor-return
}
