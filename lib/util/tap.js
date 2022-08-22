// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// suggested usage
// .then(some(annoying(nonsense, here)))
//     v  v  v  v  v   v  v  v  v  v
// .then(some(tap('annoying:', annoying(nonsense, here))))
//     v  v  v  v  v   v  v  v  v  v  v  v  v  v  v  v  v   v  v  v  v  v
// .then(some(tap('annoying:', annoying(tap('nonsense:', nonsense), here))))

/* eslint-disable no-console */
global.tap = (...xs) => { console.log(...xs); return xs[xs.length - 1]; };
global.tap.trace = (...xs) => { console.trace(...xs); return xs[xs.length - 1]; };
/* eslint-enable no-console */

