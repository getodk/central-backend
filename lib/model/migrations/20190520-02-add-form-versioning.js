// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // 1. first, prepare for a bunch of data migration, by giving the new/modified
  // data a place to live. we start by creating the transformations table, which
  // tracks the type of change between each form schema.
  await db.schema.createTable('transformations', (transformations) => {
    transformations.increments('id');
    transformations.string('system', 8).unique();
  });

  // now put some basic system transformations in.
  await db.insert([
    { system: 'identity' }, // all data is compatible as-is.
    { system: 'void' } // abandon all extant data as incompatible.
  ]).into('transformations');

  // and pull them back out right away and turn them into a mapping for later.
  const xfm = {};
  for (const { id, system } of await db.select('*').from('transformations'))
    xfm[system] = id;

  // we start by creating the definitions table, which splits
  // information from forms out.
  await db.schema.createTable('definitions', (definitions) => {
    definitions.increments('id');
    definitions.integer('formId').notNull();
    definitions.integer('transformationId');
    definitions.integer('keyId');
    definitions.text('xml');
    definitions.text('hash');
    definitions.text('version');
    definitions.dateTime('createdAt');

    // we create this to help the migration; we'll delete it before it's over:
    definitions.integer('oldFormId');

    definitions.foreign('formId').references('forms.id');
    definitions.foreign('transformationId').references('transformations.id');
    definitions.foreign('keyId').references('keys.id');

    definitions.unique([ 'formId', 'version' ]);
    definitions.index([ 'id', 'formId' ]);
  });

  // and modify the form attachments table, which will need to point at form definitions
  // rather than forms.
  await db.schema.table('form_attachments', (attachments) => {
    attachments.integer('schemaId');
    attachments.foreign('schemaId').references('definitions.id');
  });

  // last, modify the submissions table for the same reason. the main difference
  // here will come later; we will preserve both ID refs (forms / definitions).
  await db.schema.table('submissions', (submissions) => {
    submissions.integer('schemaId');
    submissions.foreign('schemaId').references('definitions.id');
  });

  // 2. now actually split the relevant information out from forms. this is a somewhat
  // involved query so we'll just write it out rather than use the builder.
  // some of the subselects are slow but of course 1 this is a one-time migration, and
  // 2 the number of forms should order on dozens/100s, not thousands/10ks.
  await db.raw(`
    insert into definitions (xml, hash, version, "createdAt", "oldFormId", "formId", "transformationId") (
      select
        xml, hash, version, "createdAt",
        id as "oldFormId",
        "lastId" as "formId",
        (case when "firstId" = id then null else ${xfm['void']} end) as "transformationId"
      from forms
      inner join (
        select min(id) as "firstId", max(id) as "lastId", "xmlFormId" from forms group by "xmlFormId"
      ) as f2 on f2."xmlFormId" = forms."xmlFormId"
    );
  `);

  // 3. now that the definitions table has all our back and current versions in it,
  // we can reassociate all submissions and form attachments to it instead.
  await db.raw(`
    update form_attachments set "schemaId" = definitions.id
      from definitions
      where definitions."oldFormId" = form_attachments."formId"
  `);
  await db.raw(`
    update submissions set "schemaId" = definitions.id
      from definitions
      where definitions."oldFormId" = submissions."formId"
  `);

  // and then we can delete the old formId references, and enforce notNull on the
  // schema references instead..
  await db.schema.table('form_attachments', (fa) => {
    fa.dropColumn('formId');
    fa.integer('schemaId').notNullable().alter();
  });
  await db.schema.table('submissions', (submissions) => {
    submissions.dropColumn('formId');
    submissions.integer('schemaId').notNullable().alter();
  });

  // 4. now we can rework the forms table itself. we start by dropping all but
  // the latest record for each xmlFormId.
  await db.raw(`
    with lasts as (
      select max(id) as "lastId", "projectId", "xmlFormId" from forms
        group by "xmlFormId", "projectId"
    )
    delete from forms
      using lasts
      where forms."projectId" = lasts."projectId"
        and forms."xmlFormId" = lasts."xmlFormId"
        and forms.id < lasts."lastId";
  `);

  // now that all duplicate records are gone, we can drop some columns and rework
  // some of the constraints. we start by restructuring the ("xmlFormId", version, "projectId")
  // uniqueness constraint, which is now made more difficult by the fact that version
  // is in a separate table from xmlFormId/projectId. we need a trigger:
  // (we leave this unindented as the database will store the function text as-is)
  await db.raw(`
create or replace function check_form_version() returns trigger as $check_form_version$
  declare extant int;
  declare pid int;
  declare fid text;
  begin
    select "projectId", "xmlFormId" into pid, fid
      from forms
      where forms.id = NEW."formId";

    select count(*) into extant
      from definitions
      inner join (
        select id, "projectId", "xmlFormId", version from forms
      ) as forms on forms.id = definitions."formId"
          and forms."projectId" = pid
          and forms."xmlFormId" = fid
      where definitions.version = NEW.version
      limit 1;

    if extant > 0 then
      raise exception 'ODK02:%:%L:%L', pid, fid, NEW.version;
    end if;

    return NEW;
  end;
$check_form_version$ language plpgsql;
`);
  await db.raw(`create trigger check_form_version before insert or update on definitions
    for each row execute procedure check_form_version();`);

  // now we drop the old constraint that we just reworked, and then drop the columns
  // that are now tracked in schema instead.
  await db.schema.table('forms', (forms) => {
    forms.dropUnique([ 'xmlFormId', 'version', 'projectId' ]);
    forms.dropColumn('xml');
    forms.dropColumn('version');
    forms.dropColumn('hash');
  });

  // 5. final cleanup: now adjust the definitions table to remove the temporary column.
  await db.schema.table('definitions', (definitions) => {
    definitions.dropColumn('oldFormId');
  });
};

const down = (db) => {}; // no way. can't go back.

module.exports = { up, down };

