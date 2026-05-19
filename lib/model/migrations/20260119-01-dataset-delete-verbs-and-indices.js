// Copyright 2026 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`UPDATE roles
    SET verbs = verbs || '["dataset.delete"]'::jsonb
    WHERE system IN ('admin', 'manager')`);

  await db.raw('ALTER TABLE datasets DROP CONSTRAINT datasets_name_projectid_unique');
  await db.raw(`CREATE UNIQUE INDEX dataset_projectid_name_deletedat_unique ON public.datasets ("projectId", "name") WHERE ("deletedAt" IS NULL)`);
};

const down = async (db) => {
  await db.raw(`UPDATE roles
    SET verbs = verbs - 'dataset.delete'
    WHERE system IN ('admin', 'manager')`);

  await db.raw('DROP INDEX dataset_projectid_name_deletedat_unique');
  await db.raw('ALTER TABLE datasets ADD CONSTRAINT datasets_name_projectid_unique UNIQUE ("name", "projectId")');
};

module.exports = { up, down };
