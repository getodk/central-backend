// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`
create or replace function check_form_state() returns trigger as $check_form_state$
  begin
    if NEW.state is null or NEW.state not in ('draft', 'open', 'closing', 'closed') then
      raise exception 'ODK03:%', NEW.state;
    end if;
    return NEW;
  end;
$check_form_state$ language plpgsql;
`);
  await db.raw(`create trigger check_form_state before insert or update on forms
    for each row execute procedure check_form_state();`);
};

const down = async (db) => {
  await db.raw('drop trigger check_form_state on forms;');
  await db.raw('drop function check_form_state;');
};

module.exports = { up, down };

