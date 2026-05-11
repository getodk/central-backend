// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // 1. first rework all the form.attachment.update audit logs.
  await db.raw(`
    update audits
      set
        "acteeId" = forms."acteeId",
        details = details
          || jsonb_build_object('formDefId', form_attachments."formDefId")
          || jsonb_build_object('name', form_attachments.name)
      from form_attachments, forms
      where
        audits."acteeId" = form_attachments."acteeId" and
        forms.id = form_attachments."formId" and
        action = 'form.attachment.update';`);

  // 2. and then drop the acteeId column from form attachments.
  await db.schema.table('form_attachments', (fa) => {
    fa.dropColumn('acteeId');
  });

  // 3. remove all the dead acteeIds.
  await db.raw("delete from actees where species = 'form_attachment';");
};

const down = () => {};

module.exports = { up, down };

