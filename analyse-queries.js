#!/usr/bin/env node

const { execSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');

const log = (...args) => console.log('[analyse-queries]', ...args);

const rootDir = './gha-logs';

const [,,...args] = process.argv;
const jobId = args.length ? args[0] : execSync(`ls -td ${rootDir}/* | head -1`, { encoding:'utf8' }).substring(rootDir.length + 1).trim();
log('job id:', jobId);

const allQueries = {};

for(const _f of readdirSync(`./gha-logs/${jobId}`)) {
  const f = `${rootDir}/${jobId}/${_f}`;
  log('Processing:', f);

  const queryPrefix = 'Open queries: ';
  readFileSync(f, 'utf8')
      .split('\n')
      .filter(it => it.includes(queryPrefix))
      .flatMap(it => {
        const [ prefix, json ] = it.split(queryPrefix);
        console.log(prefix);
        const q = JSON.parse(json);
        return q;
      })
      .forEach(processQuery)
      ;
}

function processQuery({ state, query_start, query }) {
  console.log(state);
}
