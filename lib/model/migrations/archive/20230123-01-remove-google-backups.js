// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // Delete configs related to backups.
  await db.raw("DELETE FROM config WHERE key IN ('backups.main', 'backups.google')");

  // Delete unused backup creation tokens. These three statements mirror those
  // in Actors.consume().
  const [{ id: roleId }] = await db.select('id').from('roles')
    .where({ system: 'initbkup' });
  await db.raw(`UPDATE actors SET "deletedAt" = now()
FROM assignments
WHERE
  assignments."actorId" = actors.id AND
  assignments."roleId" = ? AND
  actors.type = 'singleUse'`, [roleId]);
  await db.raw(`DELETE FROM sessions WHERE "actorId" IN (
  SELECT id FROM actors
  JOIN assignments ON
    assignments."actorId" = actors.id AND
    assignments."roleId" = ?
  WHERE actors.type = 'singleUse'
)`, [roleId]);
  await db.raw('DELETE FROM assignments WHERE "roleId" = ?', [roleId]);

  // Delete the role assigned to backup creation tokens.
  await db.raw('DELETE FROM roles WHERE id = ?', [roleId]);
};

const down = () => {};

module.exports = { up, down };
