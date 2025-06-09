// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // This index is being added to facilitate the ownerOnly feature. If/when we
  // add a concept of an entity owner, we will want to index the ownerId.
  // Perhaps at that point, we could even drop the index on creatorId.
  await db.raw(`CREATE INDEX entities_creatorid_index ON entities ("creatorId")`);
};

const down = async (db) => {
  await db.raw('DROP INDEX entities_creatorid_index');
};

module.exports = { up, down };
