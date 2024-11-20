// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const _ = require('lodash'); // eslint-disable-line import/no-extraneous-dependencies
const { sql } = require('slonik');

const container = require('../util/default-container');
const Problem = require('../util/problem');

(async () => {
  const context = {
    ..._.omit(container, 'with'),
    container,
    sql,
    Problem,
  };
  const replGlobals = Object.keys(context);

  try {
    // should adds itself directly to global scope, so does not need to be added to the context
    require('should'); // eslint-disable-line import/no-extraneous-dependencies
    require('../../test/assertions');
    replGlobals.push('should');
  } catch (err) { /* skip devDependencies if unavailable */ }

  console.log('Available vars:', replGlobals.sort().join(', '));

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
