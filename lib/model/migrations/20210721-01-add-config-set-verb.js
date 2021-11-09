// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// backup.create and backup.terminate will be combined into a single verb,
// config.set. If a role permitted backup.create but not backup.terminate (or
// vice versa), that role will now permit both. However, that shouldn't be an
// issue, because the two verbs should go hand-in-hand.
const up = (db) => db.raw(`
update roles
set verbs = (verbs - 'backup.create' - 'backup.terminate') || '["config.set"]'::jsonb
where verbs \\? 'backup.create' or verbs \\? 'backup.terminate'`);

const down = (db) => db.raw(`
update roles
set verbs = (verbs - 'config.set') || '["backup.create", "backup.terminate"]'::jsonb
where verbs \\? 'config.set'`);

module.exports = { up, down };

