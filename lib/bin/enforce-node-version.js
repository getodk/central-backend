// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const semver = require('semver'); // eslint-disable-line import/no-extraneous-dependencies
const pkg = require('../../package.json');

const expected = pkg.engines.node;
const actual = process.version;

if (!semver.satisfies(actual, expected)) {
  throw new Error(`Current Node.js version '${actual}' does not meet version required in package.json ('${expected}'.)`);
}
