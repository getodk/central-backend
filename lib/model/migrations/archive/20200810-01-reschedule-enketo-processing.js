// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // requeue all published forms.
  const forms = await db.select('acteeId').from('forms')
    .whereNull('deletedAt')
    .whereNotNull('currentDefId');
  const formInserts = forms.map(({ acteeId }) => ({
    action: 'upgrade.process.form',
    acteeId,
    loggedAt: new Date(),
    details: { upgrade: 'As part of upgrading Central to v1.0, this form is being reprocessed for web browser usage.' }
  }));
  await db.insert(formInserts).into('audits');
};

const down = () => {};

module.exports = { up, down };

