// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // This index supports the query pattern: (audits.details->'entityUuids') @> '[entity_uuid]'
  // and is filtered to only bulk delete and restore actions.
  await db.raw(`
    DROP INDEX audits_details_entityUuids;

    CREATE INDEX audits_details_entityUuids
    ON audits USING gin ((details -> 'entityUuids') jsonb_path_ops)
    WHERE action IN ('entity.purge', 'entity.bulk.delete', 'entity.bulk.restore');
  `);
};

const down = async (db) => {
  await db.raw(`
    DROP INDEX audits_details_entityUuids;
    
    CREATE INDEX audits_details_entityUuids 
    ON audits USING gin ((details -> 'entityUuids') jsonb_path_ops)
    WHERE action = 'entity.purge';
  `);
};

module.exports = { up, down };
