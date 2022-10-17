// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

import fetch from 'node-fetch';
import { program } from 'commander';

const _log = (...args) => console.log(`[${new Date().toISOString()}]`, '[rate-tester]', ...args);
const log  = (...args) => true  && _log('INFO',   ...args);
log.debug  = (...args) => false && _log('DEBUG',  ...args);
log.info   = log;
log.error  = (...args) => true  && _log('ERROR',  ...args);
log.report = (...args) => true  && _log('REPORT', ...args);

program
    .option('-s, --server-url <serverUrl>', 'URL of ODK Central server', 'http://localhost:8989')
    .option('-c, --request-count <requestCount>', 'Number of requests to make with each authN method', 100)
    ;
program.parse();
const { serverUrl, requestCount } = program.opts();

log(`Testing authN limit on server ${serverUrl}...`);

runTests();

async function runTests() {
  await test('Session-based', (email, password) => apiPostJson('sessions', { email, password }));
  await test('Basic Auth',    (email, password) => apiGet('projects/1/forms', { Authorization:`Basic ${base64(`${email}:${password}`)}` }));
}

async function test(testName, testFn) {
  const start = Date.now();
  const promises = [];
  for(let i=0; i<requestCount; ++i) {
    const email = randomEmail();
    const password = randomPassword();
    const p = testFn(email, password);
    promises.push(p);
  }
  await Promise.all(promises);
  const totalTime = Date.now() - start;
  console.log('TEST:', testName);
  console.log('|', 'Time taken:', durationForHumans(totalTime));
  console.log('|', 'Throughput:', oneDp(requestCount/(totalTime/1000)), 'req/s');
}

function apiPostJson(path, body, headers) {
  return apiPost(path, JSON.stringify(body), { 'Content-Type':'application/json', ...headers });
}

async function apiPost(path, body, headers) {
  const res = await apiFetch('POST', path, body, headers);
  return res.json();
}

async function apiGet(path, headers) {
  const res = await apiFetch('GET', path, undefined, headers);
  return res.text();
}

async function apiFetch(method, path, body, headers) {
  const url = `${serverUrl}/v1/${path}`;

  const res = await fetch(url, { method, body, headers });
  log.debug(method, res.url, '->', res.status);
  if(res.status !== 401) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}

function randInt(spread, min=0) {
  return min + Math.floor(Math.random() * spread);
}

function durationForHumans(ms) {
  if(ms > 1000) return oneDp((ms / 1000)) + 's';
  else          return oneDp(         ms) + 'ms';
}

function randomEmail() {
  let length = randInt(12, 4);
  let name = '';
  while(--length) {
    name += String.fromCharCode(randInt(26, 97));
  }
  return `${name}@example.com`;
}

function randomPassword() {
  let length = randInt(8, 12);
  let pword = '';
  while(--length) {
    if(randInt(1) > 0.5) pword += randLowerCaseLetter();
    else                 pword += randUpperCaseLetter();
  }
  return pword;
}

function randLowerCaseLetter() {
  return String.fromCharCode(randInt(26, 97));
}

function randUpperCaseLetter() {
  return String.fromCharCode(randInt(26, 65));
}

function oneDp(n) {
  return Number(n.toFixed(1));
}
