// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const up = async (db) => {
  await db.raw(`
create or replace function check_field_collisions() returns trigger as $check_field_collisions$
  declare extant int;
  declare extpath text;
  begin
    select count(distinct type), path into extant, extpath
      from form_fields group by "formId", path having count(distinct type) > 1;

    if extant > 0 then
      raise exception using message = format('ODK05:%s', extpath);
    end if;

    return NEW;
  end;
$check_field_collisions$ language plpgsql;
`);

  await db.raw(`create trigger check_field_collisions after insert on form_fields
    for each row execute procedure check_field_collisions();`);
};

const down = async (db) => {
  await db.raw('drop trigger check_field_collisions on form_fields');
  await db.raw('drop function check_field_collisions');
};

module.exports = { up, down };

