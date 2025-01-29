// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
CREATE INDEX audits_details_entity_uuid ON public.audits USING hash ((details->'entity'->>'uuid'))
WHERE ACTION IN ('entity.create', 'entity.update', 'entity.update.version', 'entity.update.resolve', 'entity.delete', 'entity.restore');

CREATE INDEX audits_details_entityUuids ON audits USING gin ((details -> 'entityUuids') jsonb_path_ops)
WHERE ACTION = 'entities.purge';
`);

const down = ((db) => db.raw(`
DROP INDEX audits_details_entity_uuid;
DROP INDEX audits_details_entityUuids;
`));

module.exports = { up, down };

