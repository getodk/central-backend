// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
  UPDATE audits
    SET details = details || jsonb_build_object('entityId', entities."id") || jsonb_build_object('entityDefId', entity_defs."id")
    FROM entities
    JOIN datasets ON entities."datasetId" = datasets.id
    JOIN entity_defs ON entities.id = entity_defs."entityId" AND root
    WHERE
      audits.action = 'entity.create' AND
      audits."acteeId" = datasets."acteeId" AND
      entities.uuid::text = audits.details->'entity'->>'uuid'`);

const down = () => {};

module.exports = { up, down };
