#!/usr/bin/env node

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
