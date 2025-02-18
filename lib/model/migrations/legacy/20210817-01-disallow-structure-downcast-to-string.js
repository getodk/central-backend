// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const up = async (db) => {
  await db.raw(`
create or replace function check_field_collisions() returns trigger as $check_field_collisions$
  declare extant int;
  declare extformid int;
  declare extpath text;
  declare exttype text;
  begin
    -- factoring the repeated joins here into a CTE explodes the cost by 10x

    select count(distinct type), form_fields."formId", form_fields.path into extant, extformid, extpath
      from form_fields

      -- finds canonical formDefIds (published, or active draft)
      left outer join (select id from form_defs where "publishedAt" is not null) as form_defs
        on form_defs.id = form_fields."formDefId"
      left outer join (select id, "draftDefId" from forms) as forms
        on forms."draftDefId" = form_fields."formDefId"

      -- weeds out paths whose latest def indicates they are a string. first figure
      -- out latest def, then knock out latest strings from conflict detection.
      inner join
        (select form_fields."formId", max("formDefId") as "latestDefId" from form_fields
          -- this is a repeat of the above canonical-def subquery
          left outer join (select id from form_defs where "publishedAt" is not null) as ifds
            on ifds.id = form_fields."formDefId"
          left outer join (select id, "draftDefId" from forms) as ifs
            on ifs."draftDefId" = form_fields."formDefId"
          where ifs.id is not null or ifds.id is not null
          group by form_fields."formId"
        ) as tail
        on tail."formId" = form_fields."formId"
      left outer join
        (select form_fields."formId", form_fields.path, true as found from form_fields
          -- this is another repeat of the above canonical-def subquery
          left outer join (select id from form_defs where "publishedAt" is not null) as ifds
            on ifds.id = form_fields."formDefId"
          left outer join (select id, "draftDefId" from forms) as ifs
            on ifs."draftDefId" = form_fields."formDefId"
          where type='repeat' or type='structure'
          group by "formId", path) as structurals
          on (structurals."formId"=form_fields."formId" and structurals.path=form_fields.path)
      inner join
        (select "formDefId", path from form_fields where type != 'string') as nonstring
        on ("latestDefId" = nonstring."formDefId" and form_fields.path = nonstring.path)
          or structurals.found is true

      where forms.id is not null or form_defs.id is not null
      group by form_fields."formId", form_fields.path having count(distinct type) > 1;

    if extant > 0 then
      select type into exttype
        from form_fields
        where "formId" = extformid and path = extpath
        order by "formDefId" desc
        limit 1
        offset 1;

      raise exception using message = format('ODK05:%s:%s', extpath, exttype);
    end if;

    return NEW;
  end;
$check_field_collisions$ language plpgsql;
`);
};

const down = () => {}; // no. would cause problems.

module.exports = { up, down };

