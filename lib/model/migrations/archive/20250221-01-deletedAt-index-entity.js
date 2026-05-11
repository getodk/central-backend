// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const up = async (db) => {
  await db.raw('CREATE INDEX entities_deletedat_index ON public.entities USING btree ("deletedAt")');
  await db.raw('CREATE INDEX entity_defs_sourceid_index ON public.entity_defs USING btree ("sourceId");');
};

const down = async (db) => {
  await db.raw('DROP INDEX entities_deletedat_index');
  await db.raw('DROP INDEX entity_defs_sourceid_index');
};

module.exports = { up, down };
