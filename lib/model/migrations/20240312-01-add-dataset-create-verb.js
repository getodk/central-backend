// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.query(`
UPDATE roles
SET verbs = verbs || '["dataset.create"]'::jsonb
WHERE system in ('admin', 'manager')
`);

const down = (db) => db.query(`
UPDATE roles
SET verbs = (verbs - 'dataset.create')
WHERE system in ('admin', 'manager')
`);

module.exports = { up, down };

