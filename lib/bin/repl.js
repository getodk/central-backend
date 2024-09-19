#!/usr/bin/env node
const { sql } = require('slonik');
const container = require('../util/default-container');

(async () => {
  const containerKeys = Object.keys(container);
  const contextKeys = [ 'sql', ...containerKeys ].sort();
  console.log('Available vars:', contextKeys.join(', '));

  const repl = require('repl').start();
  await new Promise((resolve, reject) => {
    repl.setupHistory('.repl-history', err => {
      if (err) reject(err);
      else resolve();
    });
  });
  repl.context.sql = sql;
  containerKeys.forEach(k => { repl.context[k] = container[k]; });
})();
