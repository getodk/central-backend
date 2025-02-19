// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // All column "name" to form_defs to store the title of a form
  // Most places in central, the name of a form is called the "name"
  // and only in the XForm/XLSForm is it called "title", so we are going
  // with calling it "name" everywhere in the code, even in the database.
  await db.schema.table('form_defs', (fd) => {
    fd.text('name');
  });

  await db.raw('ALTER TABLE form_defs DISABLE TRIGGER check_managed_key');
  await db.raw(`update form_defs
set name = (xpath(
  '/*[local-name() = ''html'']/*[local-name() = ''head'']/*[local-name() = ''title'']/text()',
  xml::xml
))[1]::text
where xml_is_well_formed_document(xml)`);
  await db.raw('ALTER TABLE form_defs ENABLE TRIGGER check_managed_key');
};

const down = (db) => db.schema.table('form_defs', (fd) => {
  fd.dropColumn('name');
});

module.exports = { up, down };

