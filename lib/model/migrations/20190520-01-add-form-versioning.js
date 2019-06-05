// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { shasum, sha256sum } = require('../../util/crypto');
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

  // 1b. now we create the xforms table, which contains xform blobs and info.
  await db.schema.createTable('xforms', (xforms) => {
    xforms.increments('id');
    xforms.text('xml').notNull();
    xforms.string('hash', 32).notNull(); // md5. named hash for legacy reasons.
    xforms.string('sha', 40).notNull();
    xforms.string('sha256', 64).notNull().unique();
    xforms.text('version').notNull();
  });

  // next, we create a table binding logical forms to their xforms.
  await db.schema.createTable('form_versions', (versions) => {
    versions.integer('formId').notNull();
    versions.integer('xformId').notNull();
    versions.integer('transformationId');
    versions.dateTime('createdAt');

    versions.foreign('formId').references('forms.id');
    versions.foreign('xformId').references('xforms.id');
    versions.primary([ 'formId', 'xformId' ]);
  });

  // and modify the form attachments table, which will need to point at xform definitions
  // as well as logical forms.
  await db.schema.table('form_attachments', (attachments) => {
    attachments.integer('xformId');
    attachments.foreign('xformId').references('xforms.id');
  });

  // 1c. now we do all of the above for submissions as well.
  //
  // the difference is that while the latest form definition may not be the desired
  // canonical definition, the latest submission version can safely be assumed. so
  // our join structure is different; rather than having a (formId, xformId) composite
  // primary key with an auxiliary version table that attaches additional metadata
  // to the join, we give our submission versions their own incr pkey.
  //
  // at that point, the only decision is whether to store the xml inline, or put it
  // in a join table. the initial instinct might be to still leave submission xmls
  // in a separate table because a lot of xform changes will be transparent to extant
  // submission data and so the new record would simply have the same xml data copied
  // exactly again.
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
  // so we store the xml right alongside the version record.
  await db.schema.createTable('submission_versions', (versions) => {
    versions.increments('id');
    versions.integer('submissionId').notNull();
    versions.text('xml').notNull();
    versions.integer('xformId').notNull();
    versions.integer('actorId').notNull();
    versions.dateTime('createdAt');

    versions.index('createdAt');
    versions.index([ 'id', 'submissionId' ]);
    versions.foreign('submissionId').references('submissions.id');
    versions.foreign('xformId').references('xforms.id');
    versions.foreign('actorId').references('actors.id');
  });

  await db.schema.table('submission_attachments', (attachments) => {
    attachments.integer('subVersionId');
    attachments.foreign('subVersionId').references('submission_versions.id');
  });

  // 2. now actually copy relevant information out from forms and submissions.

  // 2a. first, we do the forms. we do this by fetching all of them and manually
  // generating each query to send back to the database, because we want to compute
  // a sha for each one for future-proofing.
  await new Promise((done) => {
    db.select('*').from('forms').stream(async (stream) => {
      const work = [];
      stream.on('data', (form) => {
        work.push(db
          .insert({
            xml: form.xml, hash: form.hash, version: form.version,
            sha: shasum(form.xml), sha256: sha256sum(form.xml)
          })
          .into('xforms')
          .returning('id')
          .then(([ xformId ]) =>
            db.insert({ xformId, formId: form.id, createdAt: form.createdAt })
              .into('form_versions')));
      });
      stream.on('end', () => { Promise.all(work).then(done); });
    });
  });

  // 2b. do the same for submissions. first create all the defs and versions. we
  // need to do a little CTE here to correctly associate the defs with the versions.
  // we intentionally use the looser left outer join here rather than inner join,
  // because if something is wrong we want to fail the query based on null constraints
  // rather than drop data rows by exclusion.
  await db.raw(`
    insert into submission_versions ("submissionId", xml, "xformId", "actorId", "createdAt")
      select
          submissions.id,
          submissions.xml,
          form_versions."xformId",
          submissions.submitter,
          submissions."createdAt"
        from submissions
        left outer join (select "formId", "xformId" from form_versions)
          as form_versions on form_versions."formId" = submissions."formId";
  `);

  // 3. now that the form_defs table has all our back and current versions in it,
  // we can reassociate all submissions and form attachments to it instead.
  await db.raw(`
    update form_attachments set "xformId" = form_versions."xformId"
      from form_versions
      where form_versions."formId" = form_attachments."formId"
  `);
  await db.raw(`
    update submission_attachments set "subVersionId" = submission_versions.id
      from submission_versions
      where submission_versions."submissionId" = submission_attachments."submissionId"
  `);

  // now we can rework the primary keys and enforce notnull on the new definition
  // references.
  await db.raw('alter table form_attachments drop constraint form_attachments_pkey');
  await db.schema.table('form_attachments', (fa) => {
    fa.integer('xformId').notNullable().alter();
    fa.primary([ 'formId', 'xformId', 'name' ]);
  });

  // similar for submissions, except that we replace the existing (submissionId, name)
  // composite key with a (subVersionId, name), and drop the reference to submissionId
  // altogether.
  // (submission attachments got renamed from attachments so the pkey has a weird name)
  await db.raw('alter table submission_attachments drop constraint attachments_pkey');
  await db.schema.table('submission_attachments', (sa) => {
    sa.dropColumn('submissionId');
    sa.integer('subVersionId').notNullable().alter();

    sa.primary([ 'subVersionId', 'name' ]);
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
    -- NEW has formId, xformId
    -- need to check collisions on (xmlFormId, version, projectId)

    select count(*), "projectId", "xmlFormId", version into extant, pid, xmlid, vstr
      from form_versions
      inner join (select id, version from xforms)
        as xforms on xforms.id = form_versions."xformId"
      inner join (select id, "xmlFormId", "projectId" from forms)
        as forms on forms.id = form_versions."formId"
      group by "xmlFormId", version, "projectId"
      having count(form_versions."formId") > 1;

    if extant > 0 then
      raise exception using message = format('ODK02:%s:%L:%L', pid, xmlid, vstr);
    end if;

    return NEW;
  end;
$check_form_version$ language plpgsql;
`);
  await db.raw(`create trigger check_form_version after insert or update on form_versions
    for each row execute procedure check_form_version();`);

  // now we drop the old constraint that we just reworked, and then drop the columns
  // that are now tracked in schema instead. but we also have to add a column now to
  // track which definition is current.
  await db.schema.table('forms', (forms) => {
    forms.integer('currentXformId');

    forms.foreign('currentXformId').references('xforms.id');

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

  // 4b. now populate the currentXformId column we just created.
  await db.raw(`
    update forms set "currentXformId" = form_versions."xformId"
      from form_versions
      where form_versions."formId" = forms.id
  `);

  // 5. SANITY CHECK
  // now we go through and just check that the correct number of rows and all the
  // correct fields exist for all the new tables. if any problems are found, we
  // error out of the migration altogether to trigger a rollback.

  // 5a. check forms.
  // first, make sure the count of xforms matches the forms, and there is xml content
  // in all of them.
  await check('unexpected number of populated xforms', db.raw(`
    with all_forms as (select count(*) as count from forms)
      select (count(xforms.id) = (select count from all_forms)) as success from xforms
        where xforms.xml is not null;
  `));

  // now check the health of the versions join table.
  await check('improper form version joinery', db.raw(`
    with all_forms as (select count(*) as count from forms)
      select (count(xforms.id) = (select count from all_forms)) as success from xforms
        inner join form_versions on form_versions."formId" = xforms.id
        inner join forms on forms.id = form_versions."formId";
  `));

  // check that all forms have an appropriate currentXformId.
  await check('unexpected number of current xforms', db.raw(`
    with all_forms as (select count(*) as count from forms)
      select (count(xforms.id) = (select count from all_forms)) as success from xforms
        inner join forms on forms."currentXformId" = xforms.id;
  `));

  // check that sha/sha256 are populated throughout.
  await check('unexpected sha/sha256 values', db.raw(`
    with all_xforms as (select count(*) as count from xforms)
      select (count(xforms.id) = (select count from all_xforms)) as success from xforms
        where xforms.sha is not null and xforms.sha256 is not null;
  `));

  // and check that form attachments are joined correctly.
  await check('improper form attachment joinery', db.raw(`
    with all_attachments as (select count(*) as count from form_attachments)
      select (count(form_attachments.name) = (select count from all_attachments)) as success
        from form_attachments
        inner join xforms on xforms.id = form_attachments."xformId"
        inner join forms on forms."currentXformId" = xforms.id
        where form_attachments."formId" = forms.id;
  `));

  // 5b. check submissions.
  // same first check as forms; check populated versions.
  await check('unexpected number of populated submission versions', db.raw(`
    with all_versions as (select count(*) as count from submission_versions)
      select (count(submission_versions.id) = (select count from all_versions)) as success
        from submission_versions
        inner join submissions on submissions.id = submission_versions."submissionId"
        where submission_versions.xml is not null;
  `));

  // now check that all submission attachments are pointed correctly.
  await check('improper submission attachment joinery', db.raw(`
    with all_attachments as (select count(*) as count from submission_attachments)
      select (count(submission_attachments.name) = (select count from all_attachments)) as success
        from submission_attachments
        inner join submission_versions on submission_versions.id = submission_attachments."subVersionId"
        inner join submissions on submissions.id = submission_versions."submissionId";
  `));
};

const down = () => {}; // no way. can't go back.

module.exports = { up, down };

