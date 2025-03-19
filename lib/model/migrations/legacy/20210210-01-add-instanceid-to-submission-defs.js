// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('submission_defs', (sds) => {
    sds.string('instanceId', 64);
    sds.index([ 'submissionId', 'instanceId' ]);
  });

  await db.raw(`
update submission_defs set "instanceId"=submissions."instanceId"
from submissions where submissions.id=submission_defs."submissionId"`);

  await db.raw('alter table submission_defs alter column "instanceId" set not null');

  await db.raw(`
create or replace function check_instanceid_unique() returns trigger as $check_instanceid_unique$
  declare fid int;
  declare drft boolean;
  declare found int;
  begin
    select "formId", draft into fid, drft from submissions where submissions.id=NEW."submissionId";
    select count(*) into found from submissions
      join submission_defs on submissions.id=submission_defs."submissionId"
      where "formId"=fid and submission_defs."instanceId"=NEW."instanceId" and draft=drft;

    if found > 1 then
      raise exception using message = format('ODK06:%s', NEW."instanceId");
    end if;

    return NEW;
  end;
$check_instanceid_unique$ language plpgsql;`);

  await db.raw(`create trigger check_instanceid_unique after insert on submission_defs
    for each row execute procedure check_instanceid_unique();`);
};

const down = (db) => db.schema.table('submission_defs', (sds) => {
  sds.dropColumn('instanceId');
});

module.exports = { up, down };

