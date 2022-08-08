// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const fs = require('fs');

const header = `// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
`;

const skip = [
  'test/',
  'lib/bin/.eslintrc.js',
  'lib/util/quarantine/pkcs7.js',
];

let stdin = '';
process.stdin.resume();
process.stdin.on('data', (data) => {
  stdin += data.toString();
});
process.stdin.on('end', () => {
  const files = stdin
    .split('\n')
    .filter(f => f.endsWith('.js'))
    .filter(f => !skip.some(skipEntry => {
      if (skipEntry.endsWith('.js')) return f === skipEntry;
      if (skipEntry.endsWith('/')) return f.startsWith(skipEntry);
      throw new Error(`Invalid skip entry: '${skipEntry}'`);
    }));

  let missing = false;

  for (const entryPath of files) {
    const contents = fs.readFileSync(entryPath).toString();
    const withConsistentYear = contents.replace(/(Copyright 20)\d\d/, '$117');
    if (!withConsistentYear.startsWith(header)) {
      console.error(entryPath);
      missing = true;
    }
  }

  if (missing) {
    console.error('\nThe files above do not have the expected file header.');
    process.exit(1);
  }
});
