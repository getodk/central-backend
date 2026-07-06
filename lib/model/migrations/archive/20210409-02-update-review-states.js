// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.raw(`
create or replace function check_review_state() returns trigger as $check_review_state$
  begin
    if NEW."reviewState" is not null and NEW."reviewState" not in ('hasIssues', 'edited', 'approved', 'rejected') then
      raise exception 'ODK03:%', NEW."reviewState";
    end if;
    return NEW;
  end;
$check_review_state$ language plpgsql;
`);

const down = (db) => db.raw(`
create or replace function check_review_state() returns trigger as $check_review_state$
  begin
    if NEW."reviewState" is not null and NEW."reviewState" not in ('hasIssues', 'needsReview', 'approved', 'rejected') then
      raise exception 'ODK03:%', NEW."reviewState";
    end if;
    return NEW;
  end;
$check_review_state$ language plpgsql;
`);

module.exports = { up, down };

