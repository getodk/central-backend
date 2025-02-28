// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Helper functions that relate to the HTML/frontend layer of the application.

const config = require('config');

const envDomain = config.get('default.env.domain');

// Logic adapted from `login.vue` in frontend.
const safeNextPathFrom = next => {
  if (!next) return '/';

  let url;
  try {
    url = new URL(next, envDomain);
  } catch (e) {
    return '/';
  }

  if (url.origin !== envDomain || url.pathname === '/login')
    return '/';

  // Don't modify enketo URLs
  if (url.pathname.startsWith('/-/')) return url.toString();

  return url.pathname + url.search + url.hash;
};

module.exports = { safeNextPathFrom };
