// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`delete from sessions where "actorId" in (
  select id from actors
  where
    type = 'singleUse' and
    "displayName" = 'Backup creation token' and
    "deletedAt" is null
)`);
  await db.raw(`update actors set "deletedAt" = now()
where
  type = 'singleUse' and
  "displayName" = 'Backup creation token' and
  "deletedAt" is null`);
  await db.raw(`delete from assignments
where "roleId" in (select id from roles where system = 'initbkup')`);
  await db.raw("delete from roles where system = 'initbkup'");
};

const down = () => {};

module.exports = { up, down };
