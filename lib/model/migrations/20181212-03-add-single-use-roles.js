// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // create the roles
  const [ passwordResetRoleId, backupsVerificationRoleId ] = await db.insert([
    { name: 'Password Reset Token', system: 'pwreset', createdAt: new Date() },
    { name: 'Backups Verification Token', system: 'initbkup', createdAt: new Date() }
  ]).into('roles').returning('id');

  // grant them verbs
  await db.insert({ roleId: passwordResetRoleId, verb: 'user.password.reset' }).into('grants');
  await db.insert({ roleId: backupsVerificationRoleId, verb: 'backup.verify' }).into('grants');
};

const down = () => {}; // no going back.

module.exports = { up, down };

