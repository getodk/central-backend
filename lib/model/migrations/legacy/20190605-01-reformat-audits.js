// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // 1. attachment.update: rename to form.attachment.update since we may also
  // audit-log submission attachment actions someday.
  await db.update({ action: 'form.attachment.update' })
    .where({ action: 'attachment.update' })
    .into('audits');

  // 2a. assignment.create: rename role to roleId, acteeId to grantedActeeId in
  // the details bag.
  await db.raw(`
    update audits
      set details = jsonb_build_object('roleId', details->'role')
        || jsonb_build_object('grantedActeeId', details->'acteeId')
      where action = 'assignment.create';`);

  // 2b. assignment.delete: rename role to roleId, acteeId to revokedActeeId in
  // the details bag.
  await db.raw(`
    update audits
      set details = jsonb_build_object('roleId', details->'role')
        || jsonb_build_object('revokedActeeId', details->'acteeId')
      where action = 'assignment.delete';`);

  // 3. project.update: right now details is directly the update data; nest that
  // data into a data: {} sub-bag instead.
  await db.raw(`
    update audits
      set details = jsonb_build_object('data', details)
      where action = 'project.update';`);
};

// there's really no point in a down migration. it's maybe dangerous and there is
// no code that actually relies on the structure of any of these entries.
const down = () => {};

module.exports = { up, down };

