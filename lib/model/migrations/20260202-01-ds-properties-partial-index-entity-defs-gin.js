// Copyright 2026 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw('ALTER TABLE ds_properties DROP CONSTRAINT ds_properties_name_datasetid_unique');
  await db.raw(`CREATE UNIQUE INDEX ds_properties_datasetid_name_deletedat_unique ON public.ds_properties ("datasetId", "name") WHERE ("deletedAt" IS NULL)`);

  await db.raw('CREATE INDEX entity_defs_data_gin ON public.entity_defs USING GIN (data)');
};

const down = async (db) => {
  await db.raw('DROP INDEX entity_defs_data_gin');

  await db.raw('DROP INDEX ds_properties_datasetid_name_deletedat_unique');
  await db.raw('ALTER TABLE ds_properties ADD CONSTRAINT ds_properties_name_datasetid_unique UNIQUE ("name", "datasetId")');
};

module.exports = { up, down };
