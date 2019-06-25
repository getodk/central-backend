// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  // the keys table keeps track of all known encryption keys.
  await db.schema.createTable('keys', (keys) => {
    keys.increments('id');
    keys.text('public').notNull().unique();
    keys.jsonb('private');
    keys.boolean('managed');
    keys.text('hint');
    keys.dateTime('createdAt');

    keys.index('public');
  });

  // the keyId column tracks the active managed encryption.
  await db.schema.table('projects', (projects) => {
    projects.integer('keyId');
    projects.foreign('keyId').references('keys.id');
  });

  // the form definition implies some key. we use this to determine what keys are
  // associated with what submissions.
  // we also add an iversion column which is explained below.
  await db.schema.table('form_defs', (formDefs) => {
    formDefs.integer('keyId');
    formDefs.foreign('keyId').references('keys.id');

    formDefs.dateTime('iversion'); // internal version hack to allow duplicate version strings.
  });

  // we also need a place to store the signature, if one is provided.
  await db.schema.table('submission_defs', (submissionDefs) => {
    submissionDefs.string('encDataAttachmentName', 255);
    submissionDefs.text('localKey');
    submissionDefs.text('signature');

    submissionDefs.foreign([ 'id', 'encDataAttachmentName' ])
      .references([ 'submissionDefId', 'name' ])
      .inTable('submission_attachments');
  });

  // we need to update the (projectId, xmlFormId, version) uniqueness check to
  // add an internal hack incorporating iversion, so that we and we alone are
  // able to have duplicates of that triple (because we trust ourselves not to
  // also change the schema while we change the encryption key).
  //
  // the only difference is the inclusion of iversion in the group by clause.
  await db.raw(`
create or replace function check_form_version() returns trigger as $check_form_version$
  declare extant int;
  declare pid int;
  declare xmlid text;
  declare vstr text;
  begin
    select count(*), "projectId", "xmlFormId", version into extant, pid, xmlid, vstr
      from form_defs
      inner join (select id, "xmlFormId", "projectId" from forms)
        as forms on forms.id = form_defs."formId"
      group by "projectId", "xmlFormId", version, iversion
      having count(form_defs.id) > 1;

    if extant > 0 then
      raise exception using message = format('ODK02:%s:%L:%L', pid, xmlid, vstr);
    end if;

    return NEW;
  end;
$check_form_version$ language plpgsql;
  `);
};

const down = async (db) => {
  // first restore the old trigger:
  await db.raw(`
create or replace function check_form_version() returns trigger as $check_form_version$
  declare extant int;
  declare pid int;
  declare xmlid text;
  declare vstr text;
  begin
    select count(*), "projectId", "xmlFormId", version into extant, pid, xmlid, vstr
      from form_defs
      inner join (select id, "xmlFormId", "projectId" from forms)
        as forms on forms.id = form_defs."formId"
      group by "projectId", "xmlFormId", version
      having count(form_defs.id) > 1;

    if extant > 0 then
      raise exception using message = format('ODK02:%s:%L:%L', pid, xmlid, vstr);
    end if;

    return NEW;
  end;
$check_form_version$ language plpgsql;
  `);

  // the drop the columns and table.
  await db.schema.table('submission_defs', (submissionDefs) => {
    submissionDefs.dropColumn('encDataAttachmentName');
    submissionDefs.dropColumn('localKey');
    submissionDefs.dropColumn('signature');
  });

  await db.schema.table('projects', (projects) => {
    projects.dropColumn('keyId');
  });

  await db.schema.table('form_defs', (formDefs) => {
    formDefs.dropColumn('keyId');
  });

  await db.schema.dropTable('keys');
};

module.exports = { up, down };

