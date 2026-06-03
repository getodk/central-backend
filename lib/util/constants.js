// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const config = require('config');

const PURGE_DAY_RANGE = config.has('default.taskSchedule.purge')
  ? config.get('default.taskSchedule.purge')
  : 30; // Default is 30 days

module.exports = {
  PURGE_DAY_RANGE
};
