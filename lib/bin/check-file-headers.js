// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const fs = require('fs');

const header = `Copyright 2017 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-backend/blob/master/NOTICE.
This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.
`;
const thisYearsCopyright = `Copyright ${new Date().getFullYear()}`;
const thisYearHeader = header.replace('Copyright 2017', thisYearsCopyright);
const headerCommentPrefixByFileExt = { js: '//', sql: '--' };
const headerByFiletype = Object.fromEntries(
  Object.entries(headerCommentPrefixByFileExt)
    .map(([ext, commentPrefix]) => [ext, thisYearHeader.split('\n')
      .map(line => (line.length ? `${commentPrefix} ${line}` : '')).join('\n')])
);
const headerableFileTypes = Object.keys(headerCommentPrefixByFileExt);
const isHeaderableFile = (filename) => headerableFileTypes.some(ext => filename.endsWith(`.${ext}`));


const skip = [
  'test/',
  'lib/bin/.eslintrc.js',
  'lib/util/quarantine/pkcs7.js',
  'pm2.config.js'
];

let stdin = '';
process.stdin.resume();
process.stdin.on('data', (data) => {
  stdin += data.toString();
});
process.stdin.on('end', () => {
  const files = stdin
    .split('\n')
    .filter(f => isHeaderableFile(f))
    .filter(f => !skip.some(skipEntry => {
      if (skipEntry.endsWith('.js')) return f === skipEntry;
      if (skipEntry.endsWith('/')) return f.startsWith(skipEntry);
      throw new Error(`Invalid skip entry: '${skipEntry}'`);
    }));

  const mode = process.argv[2] === '--fix' ? 'fix' : 'check';

  let missing = false;

  for (const entryPath of files) {
    const contents = fs.readFileSync(entryPath).toString();
    const appropriateHeader = headerByFiletype[entryPath.split('.').reverse()[0]];
    const withConsistentYear = contents.replace(/Copyright 20\d\d/, thisYearsCopyright);
    if (!withConsistentYear.startsWith(appropriateHeader)) {
      console.error(entryPath);
      missing = true;

      if (mode === 'fix') {
        fs.writeFileSync(entryPath, `${appropriateHeader}\n${contents}`);
      }
    }
  }

  if (missing) {
    if (mode === 'fix') {
      console.error('\nThe files above have been changed to include the required header.');
    } else {
      console.error('\nThe files above do not have the expected file header.');
      console.error(`\nPlease re-run this script with the --fix flag, or add the following header manually,\nline-commenting each line with leading ${Object.values(headerCommentPrefixByFileExt).map(el => `"${el} "`).join(' or ')} as appropriate for the file type:`);
      console.error(`\n${thisYearHeader}`);
      process.exit(1);
    }
  }
});
