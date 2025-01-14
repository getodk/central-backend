// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// the goal here is to set the database up so that deleted users are allowed to
// have duplicate email addresses, but only one non-deleted user may have any
// given email address at a time. this is so that email lookups etc work as expected,
// but the case where eg a user is deleted and then recreated doesn't break.
//
// but the deletedAt information is in the actors table, while the email information
// is in the users table. there are thoughts of merging all the actor-related tables
// together, but until then a trigger is sadly the best option.

const func = `
create or replace function check_email() returns trigger as $check_email$
  declare extant int;
  begin
    select count(*) into extant from users inner join
      (select id from actors where "deletedAt" is null and id != NEW."actorId")
        as actors on actors.id=users."actorId"
      where email=NEW.email limit 1;
    if extant > 0 then
      raise exception 'ODK01:%', NEW.email;
    end if;
    return NEW;
  end;
$check_email$ language plpgsql;
`;

const up = (db) => db.raw(func)
  .then(() => db.raw('alter table users drop constraint users_email_unique;'))
  .then(() => db.raw(`create trigger check_email before insert or update on users
    for each row execute procedure check_email();`));

const down = (db) => db.raw('drop trigger check_email on users')
  .then(() => db.raw('create unique index users_email_unique on users(email);'))
  .then(() => db.raw('drop trigger check_email'));

module.exports = { up, down };

