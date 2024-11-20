// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw('ALTER TABLE submissions DROP CONSTRAINT submissions_formid_instanceid_draft_unique;');
  await db.raw(`CREATE UNIQUE INDEX submissions_formid_instanceid_draft_deletedat_unique
    ON submissions ("formId", "instanceId", "draft")
    WHERE "deletedAt" IS NULL;`);

  await db.raw(`
    create or replace function check_instanceid_unique() returns trigger as $check_instanceid_unique$
      declare fid int;
      declare drft boolean;
      declare found int;
      begin
        select "formId", draft into fid, drft from submissions where submissions.id=NEW."submissionId";
        select count(*) into found from submissions
          join submission_defs on submissions.id=submission_defs."submissionId"
          where "formId"=fid and submission_defs."instanceId"=NEW."instanceId" and draft=drft
          and (submissions."deletedAt" is null or submissions."draft"=false);
    
        if found > 1 then
          raise exception using message = format('ODK06:%s', NEW."instanceId");
        end if;
    
        return NEW;
      end;
    $check_instanceid_unique$ language plpgsql;`);
};

const down = async (db) => {
  await db.raw('ALTER TABLE submissions DROP CONSTRAINT submissions_formid_instanceid_draft_deletedat_unique;');
  await db.raw('CREATE UNIQUE INDEX submissions_formid_instanceid_draft_unique ON submissions ("formId", "instanceId", "draft");');
};

module.exports = { up, down };
