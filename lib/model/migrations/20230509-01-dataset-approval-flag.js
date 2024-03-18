// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // removing redundant indices from submissions
  await db.raw('ALTER TABLE datasets ADD COLUMN "approvalRequired" BOOLEAN NOT NULL DEFAULT FALSE;');
  await db.raw('UPDATE datasets SET "approvalRequired" = TRUE;');

  await db.raw('UPDATE roles SET verbs = verbs || \'["dataset.update"]\'::jsonb WHERE system in (\'admin\', \'manager\')');
};

const down = async (db) => {
  await db.raw('ALTER TABLE datasets DROP COLUMN "approvalRequired";');

  await db.raw('UPDATE roles SET verbs = verbs - \'dataset.update\' WHERE system in (\'admin\', \'manager\')');
};

module.exports = { up, down };

