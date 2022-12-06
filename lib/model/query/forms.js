// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map, compose, always } = require('ramda');
const { Frame, into } = require('../frame');
const { Actor, Blob, Form, Dataset } = require('../frames');
const { getFormFields, merge } = require('../../data/schema');
const { getDataset } = require('../../data/dataset');
const { generateToken } = require('../../util/crypto');
const { unjoiner, extender, updater, equals, insert, insertMany, markDeleted, markUndeleted, QueryOptions } = require('../../util/db');
const { resolve, reject, ignoringResult } = require('../../util/promise');
const { splitStream } = require('../../util/stream');
const { construct } = require('../../util/util');
const Option = require('../../util/option');
const Problem = require('../../util/problem');


////////////////////////////////////////////////////////////////////////////////
// IMPORT

// given binary stream, sends that stream to the configured xlsform transformation
// service and if successful returns the same result fromXml would, but with an
// additional xlsBlobId column pointing at the xls file blob id.
const fromXls = (stream, contentType, formIdFallback, ignoreWarnings) => ({ Blobs, xlsform }) =>
  splitStream(stream,
    ((s) => xlsform(s, formIdFallback)),
    ((s) => Blob.fromStream(s, contentType)))
    .then(([ { xml, itemsets, warnings }, blob ]) =>
      (((warnings.length > 0) && !ignoreWarnings)
        ? reject(Problem.user.xlsformWarnings({ warnings }))
        : Promise.all([ Form.fromXml(xml), Blobs.ensure(blob) ])
          .then(([ partial, xlsBlobId ]) => partial.withAux('xls', { xlsBlobId, itemsets }))));


////////////////////////////////////////////////////////////////////////////////
// CREATING NEW FORMS+VERSIONS

const _createNew = (form, def, project, publish) => ({ oneFirst, Actees, Forms }) =>
  Actees.provision('form', project)
    .then((actee) => oneFirst(sql`
with def as
  (insert into form_defs ("formId", xml, name, hash, sha, sha256, version, "keyId", "xlsBlobId", "draftToken", "createdAt", "publishedAt")
  values (nextval(pg_get_serial_sequence('forms', 'id')), ${form.xml}, ${def.name}, ${def.hash}, ${def.sha}, ${def.sha256}, ${def.version}, ${def.keyId}, ${form.xls.xlsBlobId || null}, ${(publish !== true) ? generateToken() : null}, clock_timestamp(), ${(publish === true) ? sql`clock_timestamp()` : null})
  returning *),
form as
  (insert into forms (id, "xmlFormId", state, "projectId", ${sql.identifier([ (publish === true) ? 'currentDefId' : 'draftDefId' ])}, "acteeId", "createdAt")
  select def."formId", ${form.xmlFormId}, ${form.state || 'open'}, ${project.id}, def.id, ${actee.id}, def."createdAt" from def
  returning forms.*)
select id from form`))
    .then(() => Forms.getByProjectAndXmlFormId(project.id, form.xmlFormId, false,
      (publish === true) ? undefined : Form.DraftVersion))
    .then((option) => option.get());

const createNew = (partial, project, publish = false) => ({ run, Datasets, FormAttachments, Forms, Keys }) =>
  Promise.all([
    partial.aux.key.map(Keys.ensure).orElse(resolve(null)),
    getFormFields(partial.xml),
    partial.aux.key.isDefined() ? resolve(Option.none()) : getDataset(partial.xml) // Don't parse dataset schema if Form has encryption key
  ])
    .then(([ keyId, fields, dataset ]) => Forms._createNew(partial, partial.def.with({ keyId }), project, publish)
      .then((savedForm) => {
        const ids = { formId: savedForm.id, formDefId: savedForm.def.id };
        return Promise.all([
          FormAttachments.createNew(partial.xml, savedForm, partial.xls.itemsets),
          run(insertMany(fields.map((field) => new Form.Field(Object.assign(field, ids)))))
        ])
          .then(() => {
            if (dataset.isDefined()) {
              const dsPropertyFields = fields.filter((field) => (field.propertyName));
              if (dsPropertyFields.filter((field) => field.propertyName === 'name' || field.propertyName === 'label').length > 0)
                throw Problem.user.invalidEntityForm({ reason: 'Invalid Dataset property.' });
              return Datasets.createOrMerge(
                new Dataset({ name: dataset.get(), projectId: project.id }, { formDefId: savedForm.def.id }),
                dsPropertyFields.map((field) => new Form.Field(field, { propertyName: field.propertyName })),
                publish
              );
            }
          })
          .then(always(savedForm));
      }));

// (if we are asked to publish right away, log that too:)
createNew.audit = (form, partial, _, publish) => (log) =>
  log('form.create', form).then(() => ((publish === true)
    ? log('form.update.publish', form, { newDefId: form.currentDefId })
    : null));
createNew.audit.withResult = true;

// creates a new version (formDef) of an existing form.
//
// if publish is true, the new version supplants the published (currentDefId)
// version. if publish is false, it will supplant the draft (draftDefId) version.
// in actual practice, we only pass publish=true when enabling managed encryption,
// and we do not allow a draft version (in API logic) to be created if one already
// exists.
//
// if field paths/types collide, the database will complain.

const _getDraftToken = (form) => {
  if ((form.def.id != null) && (form.draftDefId === form.def.id)) return form.def.draftToken;
  return generateToken();
};
const createVersion = (partial, form, publish = false) => ({ run, one, Datasets, FormAttachments, Forms, Keys }) => {
  if (form.xmlFormId !== partial.xmlFormId)
    return reject(Problem.user.unexpectedValue({ field: 'xmlFormId', value: partial.xmlFormId, reason: 'does not match the form you are updating' }));

  return Promise.all([
    // ensure the encryption key exists, then make sure our new def is in the
    // database, and mark it as either draft or current.
    partial.aux.key.map(Keys.ensure).orElse(resolve(null))
      .then((keyId) => partial.def.with({ formId: form.id, keyId, xlsBlobId: partial.xls.xlsBlobId }))
      .then((def) => ((publish === true)
        ? def.with({ publishedAt: new Date(), xml: partial.xml })
        : def.with({ draftToken: _getDraftToken(form), xml: partial.xml })))
      .then(compose(one, insert))
      .then(ignoringResult((savedDef) => ((publish === true)
        ? Forms._update(form, { currentDefId: savedDef.id })
        : Forms._update(form, { draftDefId: savedDef.id })))),
    partial.aux.key.isDefined() ? resolve(Option.none()) : getDataset(partial.xml), // Don't parse dataset schema if Form has encryption key
    // process the form schema locally while everything happens
    getFormFields(partial.xml)
  ])
    .then(([ savedDef, dataset, fields ]) => {
      // deal with fields for a moment; we just need to attach a bunch of ids
      // to them for storage.
      const ids = { formId: form.id, formDefId: savedDef.id };
      const fieldsForInsert = new Array(fields.length);
      for (let i = 0; i < fields.length; i += 1)
        fieldsForInsert[i] = new Form.Field(Object.assign({}, fields[i], ids));

      return Promise.all([
        run(insertMany(fieldsForInsert)),
        FormAttachments.createVersion(partial.xml, form, savedDef, partial.xls.itemsets, publish)
      ])
        .then(() => {
          if (dataset.isDefined())
            return Datasets.createOrMerge(
              new Dataset({ name: dataset.get(), projectId: form.projectId }, { formDefId: savedDef.id }),
              fields.filter((field) => (field.propertyName)).map((field) => new Form.Field({ formDefId: savedDef.id, ...field }, { propertyName: field.propertyName })),
              publish
            );
        })
        .then(always(savedDef));
    });
};
createVersion.audit = (newDef, partial, form, _, publish) => (log) => ((publish === true)
  ? log('form.update.publish', form, { oldDefId: form.currentDefId, newDefId: newDef.id })
  : log('form.update.draft.set', form, { oldDraftDefId: form.draftDefId, newDraftDefId: newDef.id }));
createVersion.audit.withResult = true;


////////////////////////////////////////////////////////////////////////////////
// PUBLISHING MANAGEMENT

// TODO: we need to make more explicit what .def actually represents throughout.
// for now, enforce an extra check here just in case.
const publish = (form) => ({ Forms, Datasets }) => {
  if (form.draftDefId !== form.def.id) throw Problem.internal.unknown();

  const publishedAt = (new Date()).toISOString();
  return Promise.all([
    Forms._update(form, { currentDefId: form.draftDefId, draftDefId: null }),
    Forms._updateDef(form, { draftToken: null, enketoId: null, publishedAt }),
    Datasets.publishIfExists(form.def.id, publishedAt)
  ])
    .catch(Problem.translate(
      Problem.user.uniquenessViolation,
      () => Problem.user.versionUniquenessViolation({ xmlFormId: form.xmlFormId, version: form.def.version })
    ));
};
publish.audit = (form) => (log) => log('form.update.publish', form,
  { oldDefId: form.currentDefId, newDefId: form.draftDefId });

const clearDraft = (form) => ({ Forms }) => Forms._update(form, { draftDefId: null });


////////////////////////////////////////////////////////////////////////////////
// BASIC CRUD

// only updates the form. rn everywhere we update the def we do it separately.
// also, we provide these _update(Def) internally which will not log for internal
// actions.
const _update = (form, data) => ({ one }) => one(updater(form, data));
const update = (form, data) => ({ Forms }) => Forms._update(form, data);
update.audit = (form, data) => (log) => log('form.update', form, { data });

const _updateDef = (form, data) => ({ one }) => one(updater(form.def, data));

const del = (form) => ({ run }) =>
  run(markDeleted(form));
del.audit = (form) => (log) => log('form.delete', form);

const restore = (form) => ({ run }) =>
  run(markUndeleted(form));
restore.audit = (form) => (log) => log('form.restore', form);



////////////////////////////////////////////////////////////////////////////////
// PURGING SOFT-DELETED FORMS

// The main ways we'd want to choose forms to purge are
// 1. by their deletedAt date (30+ days in the past)
//    (this would be the default behavior of a purge cron job)
// 2. if deletedAt is set at all
//    (useful to purge forms immediately for testing or other time sensitive scenarios)
// 3. by a specific form id if deletedAt is also set (again for testing or potential future scenarios)

const DAY_RANGE = 30;
const _trashedFilter = (force, id, projectId) => {
  const idFilter = (id
    ? sql`and forms.id = ${id}`
    : sql``);
  const projectFilter = (projectId
    ? sql`and forms."projectId" = ${projectId}`
    : sql``);
  return (force
    ? sql`forms."deletedAt" is not null ${idFilter} ${projectFilter}`
    : sql`forms."deletedAt" < current_date - cast(${DAY_RANGE} as int) ${idFilter} ${projectFilter}`);
};

// NOTE: copypasta alert!
// The migration 20220121-02-purge-deleted-forms.js also contains a version
// of the following purge form query, and if it changes here, it should likely
// change there, too.

// Purging steps
// 1. Redact notes about forms from the audit table that reference a form
//    (includes one kind of comment on a submission)
// 2. Log the purge in the audit log with actor not set because purging isn't accessible through the api
// 3. Update actees table for the specific form to leave some useful information behind
// 4. Delete the forms and their resources from the database
// 5. Purge unattached blobs
const purge = (force = false, id = null, projectId = null) => ({ oneFirst, Blobs }) =>
  oneFirst(sql`
with redacted_audits as (
    update audits set notes = ''
    from forms
    where audits."acteeId" = forms."acteeId"
    and ${_trashedFilter(force, id, projectId)}
  ), purge_audits as (
    insert into audits ("action", "acteeId", "loggedAt", "processed")
    select 'form.purge', "acteeId", clock_timestamp(), clock_timestamp()
    from forms
    where ${_trashedFilter(force, id, projectId)}
  ), update_actees as (
    update actees set "purgedAt" = clock_timestamp(),
      "purgedName" = form_defs."name",
      "details" = json_build_object('projectId', forms."projectId",
                                    'formId', forms.id,
                                    'xmlFormId', forms."xmlFormId",
                                    'deletedAt', forms."deletedAt",
                                    'version', form_defs."version")
    from forms
    left outer join form_defs on coalesce(forms."currentDefId", forms."draftDefId") = form_defs.id
    where actees.id = forms."acteeId"
    and ${_trashedFilter(force, id, projectId)}
  ), deleted_forms as (
    delete from forms
    where ${_trashedFilter(force, id, projectId)}
    returning *
  )
select count(*) from deleted_forms`)
    .then((count) => Blobs.purgeUnattached()
      .then(() => Promise.resolve(count)));

////////////////////////////////////////////////////////////////////////////////
// CLEARING UNNEEDED DRAFTS

// Automatically hard-delete the drafts of forms when the drafts aren't needed anymore.
// 1. when a new draft is uploaded to replace an existing draft
// 2. when a project's managed encryption is turned on and every form and
//    existing drafts are replaced with encrypted versions
// 3. when delete is called directly on a draft (and a published version exists
//    for that form)

// These unneeded drafts are essentially unnatched to the form in any meaningful way, either
// as a plublished version or as the current draft.

const _draftFilter = (form, project) =>
  (form
    ? sql`and forms."id" = ${form.id}`
    : (project
      ? sql`and forms."projectId" = ${project.id}`
      : sql``));

// NOTE: copypasta alert! The following SQL also appears in 20220209-01-purge-unneeded-drafts.js
const clearUnneededDrafts = (form = null, project = null) => ({ run }) =>
  run(sql`
delete from form_defs
using forms
where form_defs."formId" = forms.id
and form_defs."publishedAt" is null
and form_defs.id is distinct from forms."draftDefId"
${_draftFilter(form, project)}`);

////////////////////////////////////////////////////////////////////////////////
// ENCRYPTION

// takes a Key object and a suffix to add to the form version string.
// we are always given primary formdefs. we also, however, need to update drafts
// if we have them.
// we also must do the work sequentially, so the currentDefId/draftDefId are not
// mutually clobbered.
const setManagedKey = (form, key, suffix) => ({ Forms }) => {
  let work;

  if (form.currentDefId != null) {
    // paranoia:
    if (form.def.id !== form.currentDefId)
      throw new Error('setManagedKey must be called with the current published def!');

    work = form.withManagedKey(key, suffix)
      .then((partial) => ((partial === false) ? null : Forms.createVersion(partial, form, true)));
  } else {
    work = resolve();
  }

  if (form.draftDefId != null)
    work = work.then(() =>
      Forms.getByProjectAndXmlFormId(form.projectId, form.xmlFormId, true, Form.DraftVersion)
        .then((option) => option.get()) // in transaction; guaranteed
        .then((draftForm) => draftForm.withManagedKey(key, suffix))
        .then((partial) => ((partial === false) ? null : Forms.createVersion(partial, form, false))));

  return work;
};


////////////////////////////////////////////////////////////////////////////////
// OPENROSA FORMLIST

const _openRosaJoiner = unjoiner(Form, Form.Def, Frame.define(into('openRosa'), 'hasAttachments'));
const getByAuthForOpenRosa = (projectId, auth, options = QueryOptions.none) => ({ all }) => all(sql`
select ${_openRosaJoiner.fields} from forms
left outer join form_defs on form_defs.id=forms."currentDefId"
left outer join
  (select "formDefId", count("formDefId" > 0) as "hasAttachments" from form_attachments
    group by "formDefId") as fa
  on forms."currentDefId"=fa."formDefId"
inner join
  (select forms.id from forms
    inner join projects on projects.id=forms."projectId"
    inner join
      (select "acteeId" from assignments
        inner join (select id from roles where verbs ? 'form.read') as role
          on role.id=assignments."roleId"
        where "actorId"=${auth.actor.map((actor) => actor.id).orElse(-1)}) as assignment
      on assignment."acteeId" in ('*', 'form', projects."acteeId", forms."acteeId")
    group by forms.id) as filtered
  on filtered.id=forms.id
where "projectId"=${projectId} and state not in ('closing', 'closed') and "currentDefId" is not null
  ${options.ifArg('formID', (xmlFormId) => sql` and "xmlFormId"=${xmlFormId}`)} and "deletedAt" is null
order by coalesce(form_defs.name, forms."xmlFormId") asc`)
  .then(map(_openRosaJoiner));


////////////////////////////////////////////////////////////////////////////////
// GETS

// helper function to gate how form defs are joined to forms in _get
/* eslint-disable indent */
const versionJoinCondition = (version) => (
  (version === '___') ? versionJoinCondition('') :
  (version == null) ? sql`form_defs.id=coalesce(forms."currentDefId", forms."draftDefId")` :
  (version === Form.DraftVersion) ? sql`form_defs.id=forms."draftDefId"` :
  (version === Form.PublishedVersion) ? sql`form_defs.id=forms."currentDefId"` :
  (version === Form.AllVersions) ? sql`form_defs."formId"=forms.id and form_defs."publishedAt" is not null` :
  sql`form_defs."formId"=forms.id and form_defs.version=${version} and form_defs."publishedAt" is not null`
);
/* eslint-enable indent */


const _getVersions = extender(Form, Form.Def)(Form.ExtendedVersion, Option.of(Actor.into('publishedBy')))((fields, extend, options, formId) => sql`
select ${fields} from forms
join form_defs on ${versionJoinCondition(Form.AllVersions)}
${extend|| sql`
  left outer join (select * from audits where action='form.update.publish') as audits
    on forms."acteeId"=audits."acteeId" and audits.details->'newDefId'=to_jsonb(form_defs.id)
  left outer join actors on audits."actorId"=actors.id
  left outer join (select id, "contentType" as "excelContentType" from blobs) as xls
    on form_defs."xlsBlobId"=xls.id`}
where forms.id=${formId} and forms."deletedAt" is null
order by "publishedAt" desc`);
const getVersions = (formId, options = QueryOptions.none) => ({ all }) => _getVersions(all, options, formId);


const _unjoiner = unjoiner(Form, Form.Def);
const getByActeeIdForUpdate = (acteeId, options, version) => ({ maybeOne }) => maybeOne(sql`
select ${_unjoiner.fields} from forms
join form_defs on ${versionJoinCondition(version)}
where "acteeId"=${acteeId} and "deletedAt" is null
for update`)
  .then(map(_unjoiner));

const getByActeeId = (acteeId, options, version) => ({ maybeOne }) => maybeOne(sql`
select ${_unjoiner.fields} from forms
join form_defs on ${versionJoinCondition(version)}
where "acteeId"=${acteeId} and "deletedAt" is null`)
  .then(map(_unjoiner));

// there are many combinations of required fields here so we compose our own extender variant.
const _getSql = ((fields, extend, options, version, deleted = false, actorId) => sql`
select ${fields} from forms
left outer join form_defs on ${versionJoinCondition(version)}
${extend|| sql`
  left outer join
    (select "formId", count(id)::integer as "submissions", max("createdAt") as "lastSubmission",
      count(case when submissions."reviewState" is null then 1 else null end) as "receivedCount",
      count(case when submissions."reviewState" = 'hasIssues' then 1 else null end) as "hasIssuesCount",
      count(case when submissions."reviewState" = 'edited' then 1 else null end) as "editedCount"
      from submissions
      where draft=${version === Form.DraftVersion} and "deletedAt" is null
      group by "formId") as submission_stats
    on forms.id=submission_stats."formId"
  left outer join (select * from audits where action='form.create') as audits
    on forms."acteeId"=audits."acteeId"
  left outer join actors on audits."actorId"=actors.id
  left outer join (select id, "contentType" as "excelContentType" from blobs) as xls
    on form_defs."xlsBlobId"=xls.id
  left outer join (select "formDefId", count(1) > 0 "entityRelated" from dataset_form_defs group by "formDefId") as dd
    on form_defs.id = dd."formDefId"`}
${(actorId == null) ? sql`` : sql`
inner join
  (select id, max(assignment."showDraft") as "showDraft" from projects
    inner join
      (select "acteeId", 0 as "showDraft" from assignments
        inner join (select id from roles where verbs ? 'form.read') as role
          on role.id=assignments."roleId"
        where "actorId"=${actorId}
      union all
      select "acteeId", 1 as "showDraft" from assignments
        inner join (select id from roles where verbs ? 'form.update') as role
          on role.id=assignments."roleId"
        where "actorId"=${actorId}) as assignment
      on assignment."acteeId" in ('*', 'project', projects."acteeId")
    group by id) as filtered
  on filtered.id=forms."projectId"`}
where ${equals(options.condition)} and forms."deletedAt" is ${deleted ? sql`not` : sql``} null
${(actorId == null) ? sql`` : sql`and (form_defs."publishedAt" is not null or filtered."showDraft" = 1)`}
order by coalesce(form_defs.name, "xmlFormId") asc`);

const _getWithoutXml = extender(Form, Form.Def)(Form.Extended, Actor.into('createdBy'))(_getSql);
const _getWithXml = extender(Form, Form.Def, Form.Xml)(Form.Extended, Actor.into('createdBy'))(_getSql);
const _get = (exec, options, xml, version, deleted, actorId) =>
  ((xml === true) ? _getWithXml : _getWithoutXml)(exec, options, version, deleted, actorId);

const getByProjectId = (projectId, xml, version, options = QueryOptions.none, deleted = false) => ({ all }) =>
  _get(all, options.withCondition({ projectId }), xml, version, deleted);
const getByProjectAndXmlFormId = (projectId, xmlFormId, xml, version, options = QueryOptions.none, deleted = false) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ projectId, xmlFormId }), xml, version, deleted);
const getByProjectAndNumericId = (projectId, id, xml, version, options = QueryOptions.none, deleted = false) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ projectId, 'forms.id': id }), xml, version, deleted);
const getAllByAuth = (auth, options = QueryOptions.none) => ({ all }) =>
  _get(all, options, null, null, false, auth.actor.map((actor) => actor.id).orElse(-1));

////////////////////////////////////////////////////////////////////////////////
// SCHEMA

const getFields = (formDefId) => ({ all }) =>
  all(sql`select * from form_fields where "formDefId"=${formDefId} order by "order" asc`)
    .then(map(construct(Form.Field)));

const getBinaryFields = (formDefId) => ({ all }) =>
  all(sql`select * from form_fields where "formDefId"=${formDefId} and "binary"=true order by "order" asc`)
    .then(map(construct(Form.Field)));

const getStructuralFields = (formDefId) => ({ all }) =>
  all(sql`select * from form_fields where "formDefId"=${formDefId} and (type='repeat' or type='structure') order by "order" asc`)
    .then(map(construct(Form.Field)));

// TODO: this could be split up into eg getFieldsForAllVersions and a lot of the
// merging work could happen elsewhere. but where isn't all that obvious so it's
// here.
//
// used by the export deleted fields option, this gives all fields we know about
// for a form, across all its published versions.
//
// N.B. will only return published form fields! do not use this to try to get draft fields.
const getMergedFields = (formId) => ({ all }) => all(sql`
select form_fields.* from form_fields
inner join
  (select id from form_defs where "publishedAt" is not null)
  as defs on defs.id=form_fields."formDefId"
where "formId"=${formId}
order by "formDefId" asc, "order" asc`)
  .then(map(construct(Form.Field)))
  .then((fields) => {
    // first, partition the fields into different versions.
    const versions = [];
    let mark = 0;
    for (let idx = 1; idx < fields.length; idx += 1) {
      if (fields[idx].formDefId !== fields[idx - 1].formDefId) {
        versions.push(fields.slice(mark, idx));
        mark = idx;
      }
    }
    versions.push(fields.slice(mark, fields.length));

    // and now reduce across all the versions. (we use native to avoid an extra slice)
    return versions.reduce(merge);
  });



////////////////////////////////////////////////////////////////////////////////
// MISC

const lockDefs = () => ({ run }) => run(sql`lock form_defs in share mode`);

const getAllSubmitters = (formId) => ({ all }) => all(sql`
select actors.* from actors
inner join
  (select "submitterId" from submissions
    where "deletedAt" is null and "formId"=${formId}
    group by "submitterId")
  as submitters on submitters."submitterId"=actors.id
order by actors."displayName" asc`)
  .then(map(construct(Actor)));


module.exports = {
  fromXls, _createNew, createNew, createVersion,
  publish, clearDraft,
  _update, update, _updateDef, del, restore, purge,
  clearUnneededDrafts,
  setManagedKey,
  getByAuthForOpenRosa,
  getVersions, getByActeeIdForUpdate, getByActeeId,
  getByProjectId, getByProjectAndXmlFormId, getByProjectAndNumericId,
  getAllByAuth,
  getFields, getBinaryFields, getStructuralFields, getMergedFields,
  lockDefs, getAllSubmitters
};

