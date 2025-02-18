// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('actees', (t) => {
    t.dateTime('purgedAt');
    t.text('purgedName');
    t.jsonb('details');
  });
};

const down = async (db) => {
  await db.schema.table('actees', (t) => {
    t.dropColumn('purgedAt');
    t.dropColumn('purgedName');
    t.dropColumn('details');
  });
};

module.exports = { up, down };


