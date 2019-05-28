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

  // we start by creating the definitions table, which splits
  // information from forms out.
  await db.schema.createTable('definitions', (definitions) => {
    definitions.increments('id');
    definitions.integer('formId').notNull();
    definitions.integer('transformationId');
    definitions.integer('keyId');
    definitions.text('xml').notNull();
    definitions.text('hash').notNull();
    definitions.text('version').notNull();
    definitions.dateTime('createdAt');

    definitions.foreign('formId').references('forms.id');
    definitions.foreign('transformationId').references('transformations.id');
    definitions.foreign('keyId').references('keys.id');

    definitions.unique([ 'formId', 'version' ]);
    definitions.index([ 'id', 'formId' ]);
  });

  // and modify the form attachments table, which will need to point at form definitions
  // rather than forms.
  await db.schema.table('form_attachments', (attachments) => {
    attachments.integer('definitionId');
    attachments.foreign('definitionId').references('definitions.id');
  });

  // last, modify the submissions table for the same reason. the main difference
  // here will come later; we will preserve both ID refs (forms / definitions).
  await db.schema.table('submissions', (submissions) => {
    submissions.integer('definitionId');
    submissions.foreign('definitionId').references('definitions.id');
  });

  // 2. now actually split the relevant information out from forms. this is a somewhat
  // involved query so we'll just write it out rather than use the builder.
  // some of the subselects are slow but of course 1 this is a one-time migration, and
  // 2 the number of forms should order on dozens/100s, not thousands/10ks.
  await db.raw(`
    insert into definitions ("formId", xml, hash, version, "createdAt")
      (select id as "formId", xml, hash, version, "createdAt" from forms);
  `);

  // 3. now that the definitions table has all our back and current versions in it,
  // we can reassociate all submissions and form attachments to it instead.
  await db.raw(`
    update form_attachments set "definitionId" = definitions.id
      from definitions
      where definitions."formId" = form_attachments."formId"
  `);
  await db.raw(`
    update submissions set "definitionId" = definitions.id
      from definitions
      where definitions."formId" = submissions."formId"
  `);

  // and then we can delete the old formId references, and enforce notNull on the
  // schema references instead..
  await db.schema.table('form_attachments', (fa) => {
    fa.dropColumn('formId');
    fa.integer('definitionId').notNullable().alter();
  });
  await db.schema.table('submissions', (submissions) => {
    submissions.dropColumn('formId');
    submissions.integer('definitionId').notNullable().alter();
  });

  // 4. now we can rework the forms table itself, dropping  some columns and rework
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
        select id, "projectId", "xmlFormId" from forms
      ) as forms on forms.id = definitions."formId"
          and forms."projectId" = pid
          and forms."xmlFormId" = fid
      where definitions.version = NEW.version
      limit 1;

    if extant > 0 then
      raise exception using message = format('ODK02:%s:%L:%L', pid, fid, NEW.version);
    end if;

    return NEW;
  end;
$check_form_version$ language plpgsql;
`);
  await db.raw(`create trigger check_form_version before insert or update on definitions
    for each row execute procedure check_form_version();`);

  // now we drop the old constraint that we just reworked, and then drop the columns
  // that are now tracked in schema instead. but we also have to add a column now to
  // track which definition is current.
  await db.schema.table('forms', (forms) => {
    forms.integer('currentDefinitionId');
    forms.dropUnique([ 'xmlFormId', 'version', 'projectId' ]);
    forms.dropColumn('xml');
    forms.dropColumn('version');
    forms.dropColumn('hash');

    forms.foreign('currentDefinitionId').references('definitions.id');
  });

  // now populate the currentDefinitionId column we just created.
  await db.raw(`
    update forms set "currentDefinitionId" = definitions.id
      from definitions
      where definitions."formId" = forms.id
  `);
};

const down = (db) => {}; // no way. can't go back.

module.exports = { up, down };

