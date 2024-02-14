// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

module.exports = {
  extends: '../../../../.eslintrc.json',
  env: {
    browser: true, // for page.waitForFunction() code
  },
  rules: {
    // This rule does not work if the node_modules directory has not been
    // populated.  Downloading playwright is quite slow, so it's probably better
    // we don't have to do that before linting.
    'import/no-unresolved': 'off',
  },
};
