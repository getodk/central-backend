// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


// the goal behind this trigger is to provide a guard against the following
// race condition:
// 1. project managed encryption is requested
// 2. lock is taken on forms table.
// 3. extant forms are pulled down to incorporate the new key
// 4. a brand new form is uploaded to the project without a key
// 5. modified project & extant forms are committed, lock is released
// 6. form now exists in managed-encryption project without the appropriate encryption set
//
// so if at any point a form is created or updated without a keyId as part of
// a project that DOES have a keyId, we throw ODK04 and either the business logic
// layer can try again, or else we can make the user try again.
const up = async (db) => {
  await db.raw(`
create or replace function check_managed_key() returns trigger as $check_managed_key$
  declare "projectKeyId" int;
  begin
    select "keyId" into "projectKeyId" from forms
      inner join projects on projects.id = forms."projectId"
      where forms.id = NEW."formId";
    if "projectKeyId" is not null and NEW."keyId" is null then
      raise exception 'ODK04';
    end if;
    return NEW;
  end;
$check_managed_key$ language plpgsql;
`);

  await db.raw(`create trigger check_managed_key after insert or update on form_defs
    for each row execute procedure check_managed_key();`);
};

const down = (db) => db.raw('drop trigger check_managed_key on form_defs')
  .then(() => db.raw('drop function check_managed_key'));

module.exports = { up, down };

