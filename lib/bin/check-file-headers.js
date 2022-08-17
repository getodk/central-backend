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

// This might not be the full list in local development: .gitignore includes
// other files. However, this list should be sufficient for CircleCI.
const skip = new Set([
  '.circleci',
  '.git',
  '.github',
  'config',
  'docs',
  'lib/bin/.eslintrc.js',
  'lib/util/quarantine/pkcs7.js',
  'node_modules',
  'test',
  '.eslintrc.json',
  '.gitignore',
  '.npmrc',
  'CONTRIBUTING.md',
  'LICENSE',
  'Makefile',
  'NOTICE',
  'README.md',
  'package-lock.json',
  'package.json'
]);

let missing = false;
const checkDir = (dirPath) => {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;
    if (!skip.has(entryPath)) {
      if (entry.isDirectory()) {
        checkDir(entryPath);
      } else {
        const contents = fs.readFileSync(entryPath).toString();
        const withConsistentYear = contents.replace(/(Copyright 20)\d\d/, '$117');
        if (!withConsistentYear.startsWith(header)) {
          console.error(entryPath);
          missing = true;
        }
      }
    }
  }
};
checkDir('.');
if (missing) {
  console.error('\nThe files above do not have the expected file header.');
  process.exit(1);
}
