// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { shasum, sha256sum } = require('../../util/crypto'); // eslint-disable-line no-restricted-modules
const assert = require('assert').strict;

const check = (message, query) =>
  query.then(({ rows }) => assert(rows[0].success, `MIGRATION: ${message}`));

const up = async (db) => {
  ////////////////////////////////////////////////////////////////////////////////
  // 1. first, prepare for a bunch of data migration, by giving the new/modified
  // data a place to live.

  // 1a. we start by creating the transformations table, which tracks the type of
  // change between each form schema.
  await db.schema.createTable('transformations', (transformations) => {
    transformations.increments('id');
    transformations.string('system', 8).unique();
  });

  // then put some basic system transformations in.
  await db.insert([
    { system: 'identity' }, // all data is compatible as-is.
    { system: 'void' } // abandon all extant data as incompatible.
  ]).into('transformations');

  // 1b. now we create the form_defs table, which contains xform blobs and some
  // additional info. it also serves as a join reference record for auxiliary tables
  // like form attachments.
  //
  // one may question the decision to store the xml inline, rather than put it in a
  // join table. the initial instinct might be to have xml in a separate table because
  // of the extra cost of copying a lot of xml text around.
  //
  // but actually, three details about postgres internals offset this concern:
  // 1. postgres tuple page size is fixed at 8KB anyway. no tuple is allowed to be
  //    larger /or smaller/ than this size. so most small xmls will have zero impact
  //    on storage tuple size.
  // 2. postgres performs compression on text columns, which with xml will have
  //    a significant impact on data size.
  // 3. large text values are compressed and stored in a separate toast table,
  //    with only a pointer to the record stored with the tuple. the nature of
  //    the toast table means that duplicate values generate no additional storage.
  //
  // so we store the xml right alongside the def record. the same is true of
  // submission xml below.
  await db.schema.createTable('form_defs', (defs) => {
    defs.increments('id');
    defs.integer('formId');
    defs.integer('transformationId');
    defs.text('xml').notNull();
    defs.string('hash', 32).notNull(); // md5. named hash for legacy reasons.
    defs.string('sha', 40).notNull();
    defs.string('sha256', 64).notNull();
    defs.text('version').notNull();
    defs.dateTime('createdAt');

    defs.foreign('formId').references('forms.id');
    defs.foreign('transformationId').references('transformations.id');
    defs.unique([ 'formId', 'sha256' ]);
  });

  // and modify the form attachments table, which will need to point at concrete
  // form defs rather than primary logical forms.
  await db.schema.table('form_attachments', (attachments) => {
    attachments.integer('formDefId');
    attachments.foreign('formDefId').references('form_defs.id');
  });

  // 1c. now we do all of the above for submissions as well.
  // the primary difference here is that submissions do not feature a field pointing
  // at the current submission def, since we can safely assume that the latest
  // (approved) submission def ought to be the canonical one, which is not
  // something we can do for forms.
  await db.schema.createTable('submission_defs', (defs) => {
    defs.increments('id');
    defs.integer('submissionId').notNull();
    defs.text('xml').notNull();
    defs.integer('formDefId').notNull();
    defs.integer('actorId').notNull();
    defs.dateTime('createdAt');

    defs.index('createdAt');
    defs.index([ 'id', 'submissionId' ]);
    defs.foreign('submissionId').references('submissions.id');
    defs.foreign('formDefId').references('form_defs.id');
    defs.foreign('actorId').references('actors.id');
  });

  await db.schema.table('submission_attachments', (attachments) => {
    attachments.integer('submissionDefId');
    attachments.foreign('submissionDefId').references('submission_defs.id');
  });

  // 2. now actually copy relevant information out from forms and submissions.

  // 2a. first, we do the forms. we do this by fetching all of them and manually
  // generating each query to send back to the database, because we want to compute
  // a sha for each one for future-proofing.
  await new Promise((done) => {
    db.select('*').from('forms').stream(async (stream) => {
      const work = [];
      stream.on('data', (form) => {
        work.push(
          db.insert({
            formId: form.id,
            xml: form.xml,
            hash: form.hash, sha: shasum(form.xml), sha256: sha256sum(form.xml),
            version: form.version,
            createdAt: form.createdAt
          }).into('form_defs')
        );
      });
      stream.on('end', () => { Promise.all(work).then(done); });
    });
  });

  // 2b. do the same for submissions: create def records cloning submissions records.
  // we intentionally use the looser left outer join here rather than inner join,
  // because if something is wrong we want to fail the query based on null constraints
  // rather than drop data rows by exclusion.
  await db.raw(`
    insert into submission_defs ("submissionId", xml, "formDefId", "actorId", "createdAt")
      select
          submissions.id,
          submissions.xml,
          form_defs.id,
          submissions.submitter,
          submissions."createdAt"
        from submissions
        left outer join (select id, "formId" from form_defs)
          as form_defs on form_defs."formId" = submissions."formId";
  `);

  // 3. now that the defs tables have all our current defs in them, we can
  // reassociate all submissions and form attachments to it instead.
  await db.raw(`
    update form_attachments set "formDefId" = form_defs.id
      from form_defs
      where form_defs."formId" = form_attachments."formId"
  `);
  await db.raw(`
    update submission_attachments set "submissionDefId" = submission_defs.id
      from submission_defs
      where submission_defs."submissionId" = submission_attachments."submissionId"
  `);

  // now we can rework the primary keys and enforce notnull on the new definition
  // references.
  await db.raw('alter table form_attachments drop constraint form_attachments_pkey');
  await db.schema.table('form_attachments', (fa) => {
    fa.integer('formDefId').notNullable().alter();
    fa.primary([ 'formDefId', 'name' ]);
  });

  // similar for submissions, except that we replace the existing (submissionId, name)
  // composite key with a (submissionDefId, name), and drop the reference to submissionId
  // altogether.
  // (submission attachments got renamed from attachments so the pkey has a weird name)
  await db.raw('alter table submission_attachments drop constraint attachments_pkey');
  await db.schema.table('submission_attachments', (sa) => {
    sa.dropColumn('submissionId');
    sa.integer('submissionDefId').notNullable().alter();

    sa.primary([ 'submissionDefId', 'name' ]);
  });

  // 4. now we can rework the forms and submissions tables, dropping  some columns
  // and reworking some of the constraints.

  // 4a. we start by restructuring the forms (xmlFormId, version, projectId) uniqueness
  // constraint, which now involves three tables, so we need a trigger.
  //
  // there is an extant constraint:
  // forms_projectid_xmlformid_deletedat_unique UNIQUE, btree ("projectId", "xmlFormId") WHERE "deletedAt" IS NULL
  // but this constraint only checks non-deleted forms; we care about version conflicts
  // across all forms living or dead. so we just check for /any/ duplicates at all.
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
  await db.raw(`create trigger check_form_version after insert or update on form_defs
    for each row execute procedure check_form_version();`);

  // now we drop the old constraint that we just reworked, and then drop the columns
  // that are now tracked in schema instead. but we also have to add a column now to
  // track which definition is current.
  await db.schema.table('forms', (forms) => {
    forms.integer('currentDefId');

    forms.foreign('currentDefId').references('form_defs.id');

    forms.dropUnique([ 'xmlFormId', 'version', 'projectId' ]);
    forms.dropColumn('xml');
    forms.dropColumn('version');
    forms.dropColumn('hash');
  });

  // and we can just drop the xml column from submissions. while we are at it, we are
  // going to rename the submitter column to submitterId, to alleviate some weird
  // pressures with the extended metadata API.
  await db.schema.table('submissions', (submissions) => {
    submissions.dropColumn('xml');
    submissions.renameColumn('submitter', 'submitterId');
  });

  // 4b. now populate the currentDefId column we just created.
  await db.raw(`
    update forms set "currentDefId" = form_defs.id
      from form_defs
      where form_defs."formId" = forms.id
  `);

  // 5. SANITY CHECK
  // now we go through and just check that the correct number of rows and all the
  // correct fields exist for all the new tables. if any problems are found, we
  // error out of the migration altogether to trigger a rollback.

  // 5a. check forms.
  // first, make sure the count of form defs match the forms, and there is xml
  // content in all of them.
  await check('unexpected number of populated form defs', db.raw(`
    with all_forms as (select count(*) as count from forms)
      select (count(form_defs.id) = (select count from all_forms)) as success
        from form_defs
        where form_defs.xml is not null;
  `));

  // check that all forms have an appropriate currentDefId.
  await check('unexpected number of current form defs', db.raw(`
    with all_forms as (select count(*) as count from forms)
      select (count(form_defs.id) = (select count from all_forms)) as success
        from form_defs
        inner join forms on forms."currentDefId" = form_defs.id;
  `));

  // check that sha/sha256 are populated throughout.
  await check('unexpected sha/sha256 values', db.raw(`
    with all_defs as (select count(*) as count from form_defs)
      select (count(form_defs.id) = (select count from all_defs)) as success
        from form_defs
        where form_defs.sha is not null and form_defs.sha256 is not null;
  `));

  // and check that form attachments are joined correctly.
  await check('improper form attachment joinery', db.raw(`
    with all_attachments as (select count(*) as count from form_attachments)
      select (count(form_attachments.name) = (select count from all_attachments)) as success
        from form_attachments
        inner join form_defs on form_defs.id = form_attachments."formDefId"
        inner join forms on forms."currentDefId" = form_defs.id
        where form_attachments."formId" = forms.id;
  `));

  // 5b. check submissions.
  // same first check as forms; check populated defs.
  await check('unexpected number of populated submission defs', db.raw(`
    with all_defs as (select count(*) as count from submission_defs)
      select (count(submission_defs.id) = (select count from all_defs)) as success
        from submission_defs
        inner join submissions on submissions.id = submission_defs."submissionId"
        where submission_defs.xml is not null;
  `));

  // now check that all submission attachments are pointed correctly.
  await check('improper submission attachment joinery', db.raw(`
    with all_attachments as (select count(*) as count from submission_attachments)
      select (count(submission_attachments.name) = (select count from all_attachments)) as success
        from submission_attachments
        inner join submission_defs on submission_defs.id = submission_attachments."submissionDefId"
        inner join submissions on submissions.id = submission_defs."submissionId";
  `));
};

const down = () => {}; // no way. can't go back.

module.exports = { up, down };

