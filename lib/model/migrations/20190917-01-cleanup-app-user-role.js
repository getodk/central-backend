// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw("update roles set verbs = verbs - 'form.list' where system = 'app_user';");
  await db.raw("update roles set system = 'app-user' where system = 'app_user';");
};

const down = async (db) => {
  await db.raw("update roles set system = 'app_user' where system = 'app-user';");
  await db.raw(`update roles set verbs = verbs || '["form.list"]'::jsonb where system = 'app_user';`);
};

module.exports = { up, down };

