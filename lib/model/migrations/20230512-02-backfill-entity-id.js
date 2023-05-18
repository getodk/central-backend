// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
  update audits
    set details = details || jsonb_build_object('entityId', entities."id") || jsonb_build_object('entityDefId', entity_defs."id")
    from entities
    join datasets on entities."datasetId" = datasets.id
    join entity_defs on entities.id = entity_defs."entityId" and root
    where
      audits.action = 'entity.create' and
      audits."acteeId" = datasets."acteeId" and
      entities.uuid::text = audits.details->'entity'->>'uuid'`);

const down = () => {};

module.exports = { up, down };
