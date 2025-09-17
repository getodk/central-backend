// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// make index no longer unique

const up = async (db) => {
  await db.raw(`
    DROP INDEX idx_fk_entity_def_sources_submissionDefId;
    CREATE INDEX idx_fk_entity_def_sources_submissionDefId        ON "entity_def_sources" ("submissionDefId");
  `);
};

const down = async (db) => {
  await db.raw(`
    DROP INDEX idx_fk_entity_def_sources_submissionDefId;
    CREATE UNIQUE INDEX idx_fk_entity_def_sources_submissionDefId        ON "entity_def_sources" ("submissionDefId");
  `);
};

module.exports = { up, down };
