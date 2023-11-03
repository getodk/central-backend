// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
UPDATE roles SET verbs = REPLACE(verbs ::TEXT, 'form', 'open_form')::JSONB
WHERE system IN ('app-user', 'formview', 'formfill', 'pub-link')`);

const down = (db) => db.raw(`
UPDATE roles SET verbs = REPLACE(verbs ::TEXT, 'open_form', 'form')::JSONB
WHERE system IN ('app-user', 'formview', 'formfill', 'pub-link')`);

module.exports = { up, down };
