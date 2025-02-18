// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.query("CREATE INDEX audits_details_entity_def_index ON audits USING HASH (((details ->> 'entityDefId')::INTEGER))");
  await db.query("CREATE INDEX audits_details_entity_source_index ON audits USING HASH (((details ->> 'sourceId')::INTEGER))");
};

const down = async (db) => {
  await db.query('DROP INDEX audits_details_entity_def_index');
  await db.query('DROP INDEX audits_details_entity_source_index');
};

module.exports = { up, down };


