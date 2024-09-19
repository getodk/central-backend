#!/usr/bin/env node
const should = require('should');
require('../../test/assertions');

const { sql } = require('slonik');

const container = require('../util/default-container');

(async () => {
  const context = { ...container, should, sql };
  const contextKeys = Object.keys(context).sort();
  console.log('Available vars:', contextKeys.join(', '));

  const repl = require('repl').start({
    useGlobal: true, // enable should.js prototype pollution
  });

  await new Promise((resolve, reject) => {
    repl.setupHistory('.repl-history', err => {
      if (err) reject(err);
      else resolve();
    });
  });

  Object.entries(context).forEach(([k, value]) => {
    Object.defineProperty(repl.context, k, {
      configurable: false,
      enumerable: true,
      value,
    });
  });
})();
