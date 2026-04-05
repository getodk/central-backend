#!/usr/bin/env node

const { execSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');

const log = (...args) => console.log('[analyse-queries]', ...args);

const rootDir = './gha-logs';

const [,,...args] = process.argv;
const runId = args.length ? args[0] : execSync(`ls -td ${rootDir}/* | head -1`, { encoding:'utf8' }).substring(rootDir.length + 1).trim();
log('run id:', runId);

const allActiveQueries = {};

for( const att of readdirSync(`${rootDir}/run-${runId}`)) {
  for(const _f of readdirSync(`${rootDir}/run-${runId}/${att}`)) {
    const f =                 `${rootDir}/run-${runId}/${att}/${_f}`;
    log('Processing:', f);
  
    const queryPrefix = 'Open queries: ';
    const activeQueries = readFileSync(f, 'utf8')
        .split('\n')
        .filter(it => it.includes(queryPrefix))
        .map(it => {
          const [ prefix, json ] = it.split(queryPrefix);
          return JSON.parse(json)
              .filter(it => it.state !== 'idle')
              .map(q => {
                const logged_at = new Date(prefix.match(/2026-\S*Z/)[0]);
                const query_start = new Date(q.query_start);
                return {
                  ...q,
                  logged_at,
                  query_start,
                  duration_so_far: logged_at.valueOf() - query_start.valueOf(),
                };
              });
          });

    const lastQueries = activeQueries.at(-1);
    log('  last activeQueries:', lastQueries);

    activeQueries
        .flat()
        .forEach(processQuery);
  }

  log('  Done.');
}

console.log('allActiveQueries:', JSON.stringify(allActiveQueries, null, 2));

function processQuery({ state, duration_so_far, query }) {
  if(!allActiveQueries[query]) allActiveQueries[query] = duration_so_far;
  allActiveQueries[query] = Math.max(allActiveQueries[query], duration_so_far);
}
