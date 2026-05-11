// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // Here, we add a new index to optimize ownerOnly datasets. The index is
  // intended to aid the FormAttachments query module as it computes
  // MAX(entities."updatedAt"), which feeds into the OpenRosa hash of the
  // dataset. The new index supersedes the previous one that only indexed on
  // creatorId.
  await db.raw(`DROP INDEX entities_creatorid_index`);
  await db.raw(`CREATE INDEX entities_datasetid_creatorid_updatedat_index
    ON entities ("datasetId", "creatorId", "updatedAt")`);
};

const down = async (db) => {
  await db.raw('DROP INDEX entities_datasetid_creatorid_updatedat_index');
};

module.exports = { up, down };
