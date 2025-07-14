// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.query('UPDATE audits SET "action" = \'entity.error\' WHERE "action" = \'entity.create.error\'');
};

const down = async (db) => {
  // will set any error back to create error, which isn't necessarily right
  await db.query('UPDATE audits SET "action" = \'entity.create.error\' WHERE "action" = \'entity.error\'');
};

module.exports = { up, down };
