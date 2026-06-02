// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('form_attachments', (atts) => {
    atts.dateTime('updatedAt');
  });

  await db.raw(`
    with logs as (
      select details->>'formDefId' as "defId", details->>'name' as name, max("loggedAt") as at
        from audits
        where action = 'form.attachment.update'
        group by details->>'formDefId', details->>'name')
    update form_attachments
      set "updatedAt" = logs.at
      from logs
      where
        form_attachments."formDefId"::text = logs."defId" and
        form_attachments.name = logs.name;`);
};

const down = (db) => db.schema.table('form_attachments', (atts) => {
  atts.dropColumn('updatedAt');
});

module.exports = { up, down };

