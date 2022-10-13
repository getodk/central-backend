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
const thisYearHeader = header.replace('2017', new Date().getFullYear());

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

  const mode = process.argv[2] === '--fix' ? 'fix' : 'check';

  let missing = false;

  for (const entryPath of files) {
    const contents = fs.readFileSync(entryPath).toString();
    const withConsistentYear = contents.replace(/(Copyright 20)\d\d/, '$117');
    if (!withConsistentYear.startsWith(header)) {
      console.error(entryPath);
      missing = true;

      if (mode === 'fix') {
        fs.writeFileSync(entryPath, `${thisYearHeader}\n${contents}`);
      }
    }
  }

  if (missing) {
    if (mode === 'fix') {
      console.error('\nThe files above have been changed to include the required header.');
    } else {
      console.error('\nThe files above do not have the expected file header.');
      console.error('\nPlease re-run this script with the --fix flag, or add the following header manually:');
      console.error(`\n${thisYearHeader}`);
      process.exit(1);
    }
  }
});
