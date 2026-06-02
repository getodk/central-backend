// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Make index no longer unique:
//
// While adding support for entities from repeats, we changed how/when the
// source for an entity def is computed.
// It is now inserted before the entity (or multi-entity) create/update is even attempted.
//
// A side effect is that in the offline entity case, there can be multiple sources
// with the same submission def if the submission came in out of order, was held in
// the backlog, and then force processed. In that case, the event id (or audit log id) is
// different, but the submission def id is the same, and we needed to remove this index.
//
// One might think removing this index is about entities from repeats themselves,
// but entities from the same submission should all share the same entity def source,
// so the submission def id should _usually_ be distinct.

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
