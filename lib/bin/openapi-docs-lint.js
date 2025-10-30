// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Additional linting for OpenAPI docs.
//
// Currently this works around spec requirements not enforced by redocly's lint:
//
// * https://github.com/Redocly/redocly-cli/issues/1347

const { readFileSync } = require('node:fs');

// eslint-disable-next-line import/no-extraneous-dependencies
const yaml = require('yaml');

const [,, f, ...tooManyArgs] = process.argv;
if (!f) throw new Error('Missing arg!');
if (tooManyArgs.length) throw new Error('Too many args!');

const docs = yaml.parse(readFileSync(f, 'utf8'), { mapAsMap: true });

let violations = 0;
for (const [path, methods] of docs.get('paths')) {
  for (const [method, methodMap] of methods) {
    const badKeys = [...methodMap.get('responses').keys()].filter(it => typeof it !== 'string');
    if (!badKeys.length) continue;

    violations += badKeys.length;
    console.log(`paths.${path}.${method}.responses:`, badKeys);
  }
}

if (violations) {
  console.log(`Validation of ${f} failed - there were ${violations} violations.  See above for details.`);
  process.exit(1);
} else {
  console.log('All OK ✅');
  process.exit();
}
