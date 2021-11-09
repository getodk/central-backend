// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// this is in its own file for circular dependency reasons.

/* eslint-disable no-multi-spaces */

const { Frame, table, readable } = require('../frame');

const Key = Frame.define(
  table('keys'),
  'id',         readable,               'public',       readable,
  'private',                            'managed',      readable,
  'hint',       readable,               'createdAt',    readable
);

module.exports = { Key };

