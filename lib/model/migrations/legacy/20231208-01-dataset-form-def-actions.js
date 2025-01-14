// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw('ALTER TABLE dataset_form_defs ADD COLUMN actions jsonb');
  await db.raw(`UPDATE dataset_form_defs SET actions = '["create"]'`);
  await db.raw('ALTER TABLE dataset_form_defs ALTER COLUMN actions SET NOT NULL');
};

const down = (db) =>
  db.raw('ALTER TABLE dataset_form_defs DROP COLUMN actions');

module.exports = { up, down };
