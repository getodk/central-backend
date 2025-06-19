// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint indent: 0 */

const { sql } = require('slonik');
const { map } = require('ramda');
const { Frame, into } = require('../frame');
const { Actor, Blob, Form } = require('../frames');
const { getFormFields, merge, compare } = require('../../data/schema');
const { getDatasets } = require('../../data/dataset');
const { generateToken } = require('../../util/crypto');
const { unjoiner, extender, updater, sqlEquals, insert, insertMany, markDeleted, markUndeleted, QueryOptions } = require('../../util/db');
const { resolve, reject, timebound } = require('../../util/promise');
const { splitStream } = require('../../util/stream');
const { construct } = require('../../util/util');
const Option = require('../../util/option');
const Problem = require('../../util/problem');
const { PURGE_DAY_RANGE } = require('../../util/constants');

const describe = m => (typeof m === 'object' ? JSON.stringify(m) : m);
const fatalError = (...message) => {
  console.log(new Error(message.map(describe).join(' '))); // eslint-disable-line no-console
  process.exit(1);
};


////////////////////////////////////////////////////////////////////////////////
// IMPORT

// given binary stream, sends that stream to the configured xlsform transformation
// service and if successful returns the same result fromXml would, but with an
// additional xlsBlobId column pointing at the xls file blob id.
const fromXls = (stream, contentType, formIdFallback, ignoreWarnings) => ({ Blobs, xlsform, context }) =>
  splitStream(stream,
    ((s) => xlsform(s, formIdFallback)),
    ((s) => Blob.fromStream(s, contentType)))
    .then(([ { xml, itemsets, warnings }, blob ]) => {
      if ((warnings.length > 0 && !ignoreWarnings)) {
        context.transitoryData.set('xlsFormWarnings', warnings);
      }
      return Promise.all([ Form.fromXml(xml), Blobs.ensure(blob) ])
        .then(([ partial, xlsBlobId ]) => partial.withAux('xls', { xlsBlobId, itemsets }));
    });


////////////////////////////////////////////////////////////////////////////////
// PUSHING TO ENKETO

// Time-bounds a request from enketo.create(). If the request times out or
// results in an error, then an empty object is returned.
const timeboundEnketo = (request, bound) =>
  (bound != null ? timebound(request, bound).catch(() => ({})) : request);

// Accepts either a Form or an object with a top-level draftToken property. Also
// accepts an optional bound on the amount of time for the request to Enketo to
// complete (in seconds). If a bound is specified, and the request to Enketo
// times out or results in an error, then `null` is returned.
const pushDraftToEnketo = ({ projectId, xmlFormId, def, draftToken = def?.draftToken }, bound = undefined) => async ({ enketo, env }) => {
  const encodedFormId = encodeURIComponent(xmlFormId);
  const path = `${env.domain}/v1/test/${draftToken}/projects/${projectId}/forms/${encodedFormId}/draft`;
  const { enketoId } = await timeboundEnketo(enketo.create(path, xmlFormId), bound);
  // Return `null` if enketoId is `undefined`.
  return enketoId ?? null;
};

// Pushes a form that is published or about to be published to Enketo. Accepts
// either a Form or a Form-like object. Also accepts an optional bound on the
// amount of time for the request to Enketo to complete (in seconds). If a bound
// is specified, and the request to Enketo times out or results in an error,
// then an empty object is returned.
const pushFormToEnketo = ({ projectId, xmlFormId, acteeId }, bound = undefined) => async ({ Actors, Assignments, Sessions, enketo, env }) => {
  // Generate a single use actor that grants Enketo access just to this form for
  // just long enough for it to pull the information it needs.
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15);
  const actor = await Actors.create(new Actor({
    type: 'singleUse',
    expiresAt,
    displayName: `Enketo sync token for ${acteeId}`
  }));
  await Assignments.grantSystem(actor, 'formview', acteeId);
  const { token } = await Sessions.create(actor, expiresAt);

  const path = `${env.domain}/v1/projects/${projectId}`;
  return timeboundEnketo(enketo.create(path, xmlFormId, token), bound);
};

////////////////////////////////////////////////////////////////////////////////
// COMMON FORM UTILITY FUNCTIONS

const _parseFormXml = (partial) => Promise.all([
  getFormFields(partial.xml),
  (partial.aux.key.isDefined() ? resolve(Option.none()) : getDatasets(partial.xml)) // Don't parse dataset schema if Form has encryption key
]);

const _insertFormFields = (fields, formId, schemaId) => async ({ run }) => {
  // Combine form fields as parsed from the form XML with the top level formId
  // and the schemaId (rather than formDefId)
  const ids = { formId, schemaId };
  const fieldsForInsert = fields.map((field) => new Form.Field(Object.assign({}, { ...field, ...ids })));
  await run(insertMany(fieldsForInsert));
};

////////////////////////////////////////////////////////////////////////////////
// CREATING NEW FORMS

const _createNew = (form, def, project) => ({ oneFirst, Forms }) =>
  oneFirst(sql`
with sch as
  (insert into form_schemas (id)
    values (default)
    returning *),
def as
  (insert into form_defs ("formId", "schemaId", xml, name, hash, sha, sha256, version, "keyId", "xlsBlobId", "draftToken", "enketoId", "createdAt")
  select nextval(pg_get_serial_sequence('forms', 'id')), sch.id, ${form.xml}, ${def.name}, ${def.hash}, ${def.sha}, ${def.sha256}, ${def.version}, ${def.keyId}, ${form.xls.xlsBlobId || null}, ${def.draftToken || null}, ${def.enketoId || null}, clock_timestamp()
    from sch
  returning *),
form as
  (insert into forms (id, "xmlFormId", state, "projectId", "draftDefId", "acteeId", "enketoId", "enketoOnceId", "createdAt", "webformsEnabled")
  select def."formId", ${form.xmlFormId}, ${form.state || 'open'}, ${project.id}, def.id, ${form.acteeId}, ${form.enketoId || null}, ${form.enketoOnceId || null}, def."createdAt", ${form.webformsEnabled || false} from def
  returning forms.*)
select id from form`)
    .then(() => Forms.getByProjectAndXmlFormId(project.id, form.xmlFormId, false, Form.DraftVersion))
    .then((option) => option.get());

const createNew = (partial, project) => async ({ Actees, Datasets, FormAttachments, Forms, Keys }) => {
  // Check encryption keys before proceeding
  const keyId = await partial.aux.key.map(Keys.ensure).orElse(resolve(null));

  // Parse form XML for fields and entity/dataset definitions
  const [fields, parsedDatasets] = await _parseFormXml(partial);

  // Check that meta field (group containing instanceId and name) exists
  await Forms.checkMeta(fields);

  // Check for xmlFormId collisions with previously deleted forms
  await Forms.checkDeletedForms(partial.xmlFormId, project.id);
  await Forms.checkDatasetWarnings(parsedDatasets);
  await Forms.rejectIfWarnings();

  // Provision Actee for form
  const acteeId = (await Actees.provision('form', project)).id;

  // We will try to push to Enketo. If doing so fails or is too slow, then the
  // worker will try again later.
  const draftToken = generateToken();
  const enketoId = await Forms.pushDraftToEnketo(
    { projectId: project.id, xmlFormId: partial.xmlFormId, draftToken },
    0.5
  );

  // Save draft form
  const savedForm = await Forms._createNew(
    partial.with({ acteeId }),
    partial.def.with({ keyId, draftToken, enketoId }),
    project
  );

  // Insert form fields and attachments for new form def
  await Forms._insertFormFields(fields, savedForm.id, savedForm.def.schemaId);
  await FormAttachments.createNew(partial.xml, savedForm, partial.xls.itemsets);

  // Update datasets and properties, if defined
  if (parsedDatasets.isDefined()) {
    await Promise.all(
      parsedDatasets.get().datasets.map(ds =>
        Datasets.createOrMerge(ds, savedForm, fields)
      )
    );
  }

  // Return new draft Form frame with Form.Def
  return savedForm;
};

// (if we are asked to publish right away, log that too:)
createNew.audit = (form) => (log) =>
  log('form.create', form);
createNew.audit.withResult = true;

////////////////////////////////////////////////////////////////////////////////
// CREATING NEW VERSIONS

// Inserts a new form def into the database for createVersion() below, setting
// fields on the def according to whether the def will be the current def or the
// draft def.
const _createNewDef = (partial, form, publish, data) => ({ one }) =>
  one(insert(partial.def.with({
    formId: form.id,
    xlsBlobId: partial.xls.xlsBlobId,
    xml: partial.xml,
    ...data,
    ...((publish === true) ? { publishedAt: new Date() } : {})
  })));

// creates a new version (formDef) of an existing form.
//
// if publish is true, the new version supplants the published (currentDefId)
// version. if publish is false, it will supplant the draft (draftDefId) version.
// in actual practice, we only pass publish=true when enabling managed encryption,
// and we do not allow a draft version (in API logic) to be created if one already
// exists.
//
// if field paths/types collide, the database will complain.
//
// Parameters:
// ===========
// partial:     Partial form definition of the new version
// form:        Form frame of existing form
// publish:     set true if you want new version to be published (used infrequently)
//     One example where publish=true is in setManagedKey, which updates the form XML.
//     Most other situations call publish() explicitly.
// duplicating: set true if copying form definition from previously uploaded definition, in that cases we don't check for structural change
//              as user has already been warned otherwise set false
const createVersion = (partial, form, publish, duplicating = false) => async ({ Datasets, FormAttachments, Forms, Keys }) => {
  // Check xmlFormId match
  if (form.xmlFormId !== partial.xmlFormId)
    return reject(Problem.user.unexpectedValue({ field: 'xmlFormId', value: partial.xmlFormId, reason: 'does not match the form you are updating' }));

  // Ensure the encryption key exists before proceeding and retrieve key to use below
  const keyId = await partial.aux.key.map(Keys.ensure).orElse(resolve(null));

  // Parse form fields and dataset/entity definition from form XML
  const [fields, parsedDatasets] = await _parseFormXml(partial);

  // Compute the intermediate schema ID
  let schemaId;
  let match;

  // If there is no current published def, only a draft, we definitely need a new schema
  // and we don't need to compare against old schemas/check for structural changes
  if (!form.currentDefId) {
    schemaId = await Forms._newSchema();
    match = false;
  } else {
    // Fetch fields of previous version to compare new schema against
    const prevFields = await Forms.getFields(form.currentDefId);
    match = compare(prevFields, fields);

    if (match)
      schemaId = prevFields[0].schemaId;
    else {
      // Only need to check new fields against old fields if the structure does not match
      const allFields = await Forms.getMergedFields(form.id);
      await Forms.checkFieldDowncast(allFields, fields);

      // skip checking for structural change if duplicating because user has already
      // been warning at the time of form definition upload
      if (!duplicating) {
        await Forms.checkStructuralChange(prevFields, fields);
      }
      // If we haven't been rejected or warned yet, make a new schema id
      schemaId = await Forms._newSchema();
    }
  }

  // Let's check for warnings before pushing to Enketo or to DB
  await Forms.rejectIfWarnings();

  // If not publishing, check whether there is an existing draft that we have access to.
  // If not, generate a draft token and enketoId.
  let { draftToken, enketoId } = form.def;
  if (!publish && (form.def.id == null || form.def.id !== form.draftDefId)) {
    draftToken = generateToken();
    enketoId = await Forms.pushDraftToEnketo(
      { projectId: form.projectId, xmlFormId: form.xmlFormId, draftToken },
      0.5
    );
  }
  // Note: If publish=true, we are in the enabling encryption special case, and we
  // will just copy over whatever enketo ids do or don't exist already.

  // Save draft def
  const savedDef = await Forms._createNewDef(partial, form, publish, { draftToken, enketoId, schemaId, keyId });

  // Prepare the form fields
  if (!match)
    await Forms._insertFormFields(fields, form.id, schemaId);

  // Insert attachments
  await FormAttachments.createVersion(partial.xml, form, savedDef, partial.xls.itemsets, publish);

  // Update datasets and properties, if defined
  if (parsedDatasets.isDefined()) {
    await Promise.all(
      parsedDatasets.get().datasets.map(ds =>
        Datasets.createOrMerge(ds, new Form(form, { def: savedDef }), fields)
      )
    );
    // Note: if publish=true, we are in the enabling encryption special case and won't
    // do dataset operations. Dataset publishing will happen only through Forms.publish().
  }

  // Note: It is rare that a form will be published here (and not in a separate step).
  // publish=true is only used when encrypting a published form
  await ((publish === true)
    ? Forms._update(form, { currentDefId: savedDef.id })
    : Forms._update(form, { draftDefId: savedDef.id }));

  return savedDef;
};

createVersion.audit = (newDef, partial, form, publish) => (log) => ((publish === true)
  ? log('form.update.publish', form, { oldDefId: form.currentDefId, newDefId: newDef.id })
  : log('form.update.draft.set', form, { oldDraftDefId: form.draftDefId, newDraftDefId: newDef.id }));
createVersion.audit.withResult = true;
createVersion.audit.logEvenIfAnonymous = true;

// This is used in the rare case where we want to change and update a FormDef in place without
// creating a new def. This is basically a wrapper around _updateDef that also logs an event.
// eslint-disable-next-line no-unused-vars
const replaceDef = (partial, form, details) => async ({ Forms }) => {
  const { version, hash, sha, sha256 } = partial.def;
  await Forms._updateDef(form.def, { xml: partial.xml, version, hash, sha, sha256 });
  // all this does is changed updatedAt
  await Forms._update(form, { updatedAt: (new Date()).toISOString() });
};

replaceDef.audit = (_, form, details) => (log) =>
  log('form.update.draft.replace', form, details);
replaceDef.audit.logEvenIfAnonymous = true;

////////////////////////////////////////////////////////////////////////////////
// PUBLISHING MANAGEMENT

// TODO: we need to make more explicit what .def actually represents throughout.
// for now, enforce an extra check here just in case.
const publish = (form, concurrentWithCreate = false) => async ({ Forms, Datasets, FormAttachments }) => {
  if (form.draftDefId !== form.def.id) throw Problem.internal.unknown();

  // dont use publish concurrentWithCreate on already published forms
  if (concurrentWithCreate && form.publishedAt != null) throw Problem.internal.unknown({ error: 'Attempting to immediately publish a form' });

  // Try to push the form to Enketo if it hasn't been pushed already. If doing
  // so fails or is too slow, then the worker will try again later.
  const enketoIds = form.enketoId == null || form.enketoOnceId == null
    ? await Forms.pushFormToEnketo(form, 0.5)
    : {};

  const publishedAt = concurrentWithCreate ? form.createdAt.toISOString() : (new Date()).toISOString();
  const [f, fd] = await Promise.all([
    Forms._update(form, { currentDefId: form.draftDefId, draftDefId: null, ...(concurrentWithCreate ? { updatedAt: null } : {}), ...enketoIds }),
    Forms._updateDef(form.def, { draftToken: null, enketoId: null, publishedAt }),
  ])
    .catch(Problem.translate(
      Problem.user.uniquenessViolation,
      () => Problem.user.versionUniquenessViolation({ xmlFormId: form.xmlFormId, version: form.def.version })
    ));

  const ds = await Datasets.publishIfExists(form.def.id, publishedAt);
  // this check is for issue c#554. we will hopefully come back to this flow and improve it later.
  // ds contains a list of objects about what happened with the dataset
  // like if the dataset was published and which properties were published.
  // if it's empty, there is no dataset to work with.
  if (ds.length > 0) {
    const dataset = await Datasets.getById(ds[0].id).then(o => o.get());
    const attachment = await FormAttachments.getByFormDefIdAndName(form.def.id, `${dataset.name}.csv`);
    if (attachment.isDefined() && attachment.get().blobId == null && attachment.get().datasetId == null) {
      await FormAttachments.update(form, attachment.get(), null, dataset.id);
    }
  }

  return new Form(f, { def: new Form.Def(fd) });
};

// We don't need the new Form but we do need to wait for the result before logging.
publish.audit = (_, form) => (log) => log('form.update.publish', form,
  { oldDefId: form.currentDefId, newDefId: form.draftDefId });
publish.audit.withResult = true;

const clearDraft = (form) => ({ Forms }) => Forms._update(form, { draftDefId: null });


////////////////////////////////////////////////////////////////////////////////
// BASIC CRUD

// only updates the form. rn everywhere we update the def we do it separately.
// also, we provide these _update(Def) internally which will not log for internal
// actions.
const _update = (form, data) => ({ one }) => one(updater(form, data));
const update = (form, data) => ({ Forms }) => Forms._update(form, data);
update.audit = (form, data) => (log) => log('form.update', form, { data });

const _updateDef = (formDef, data) => ({ one }) => one(updater(formDef, data));

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

const _trashedFilter = (force, id, projectId, xmlFormId) => {
  const idFilter = (id
    ? sql`and forms.id = ${id}`
    : sql``);
  const projectFilter = (projectId
    ? sql`and forms."projectId" = ${projectId}`
    : sql``);
  const xmlFormIdFilter = ((xmlFormId && projectId)
    ? sql`and forms."projectId" = ${projectId} and forms."xmlFormId" = ${xmlFormId}`
    : sql``);
  return (force
    ? sql`forms."deletedAt" is not null ${idFilter} ${projectFilter} ${xmlFormIdFilter}`
    : sql`forms."deletedAt" < current_date - cast(${PURGE_DAY_RANGE} as int) ${idFilter} ${projectFilter} ${xmlFormIdFilter}`);
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
const purge = (force = false, id = null, projectId = null, xmlFormId = null) => ({ oneFirst }) => {
  if (xmlFormId != null && projectId == null)
    throw Problem.internal.unknown({ error: 'Must also specify projectId when using xmlFormId' });
  return oneFirst(sql`
with redacted_audits as (
    update audits set notes = ''
    from forms
    where audits."acteeId" = forms."acteeId"
    and ${_trashedFilter(force, id, projectId, xmlFormId)}
  ), deleted_client_audits as (
    delete from client_audits
    using submission_attachments, submission_defs, submissions, forms
    where client_audits."blobId" = submission_attachments."blobId"
    and submission_attachments."submissionDefId" = submission_defs.id
    and submission_attachments."isClientAudit" = true
    and submission_defs."submissionId" = submissions.id
    and submissions."formId" = forms.id
    and ${_trashedFilter(force, id, projectId, xmlFormId)}
  ), purge_audits as (
    insert into audits ("action", "acteeId", "loggedAt", "processed")
    select 'form.purge', "acteeId", clock_timestamp(), clock_timestamp()
    from forms
    where ${_trashedFilter(force, id, projectId, xmlFormId)}
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
    and ${_trashedFilter(force, id, projectId, xmlFormId)}
  ), deleted_forms as (
    delete from forms
    where ${_trashedFilter(force, id, projectId, xmlFormId)}
    returning 1
  )
select count(*) from deleted_forms`);
};

////////////////////////////////////////////////////////////////////////////////
// CLEARING UNNEEDED DRAFTS

// Automatically hard-delete the drafts of forms when the drafts aren't needed anymore.
// 1. when a new draft is uploaded to replace an existing draft
// 2. when a project's managed encryption is turned on and every form and
//    existing drafts are replaced with encrypted versions
// 3. when delete is called directly on a draft (and a published version exists
//    for that form)

// These unneeded drafts are essentially unmatched to the form in any meaningful way, either
// as a published version or as the current draft.

const _draftFilter = (form, project) =>
  (form
    ? sql`and forms."id" = ${form.id}`
    : (project
      ? sql`and forms."projectId" = ${project.id}`
      : sql``));

// NOTE: copypasta alert! Similar SQL also appears in 20220209-01-purge-unneeded-drafts.js
// Purges draft form defs that are not referenced by the form as either currentDefId or draftDefId AND have no associated submission defs.
const clearUnneededDrafts = (form = null, project = null) => ({ run }) =>
  run(sql`
DELETE FROM form_defs
  USING forms
WHERE form_defs."formId" = forms.id
  AND form_defs."publishedAt" IS NULL
  AND form_defs.id IS DISTINCT FROM forms."draftDefId"
  AND NOT EXISTS (
      SELECT 1
      FROM submission_defs
      WHERE submission_defs."formDefId" = form_defs.id
  )
${_draftFilter(form, project)}`)
    .then(() => run(sql`
DELETE FROM form_schemas
  USING form_schemas AS fs
LEFT JOIN form_defs AS fd
  ON fd."schemaId" = fs."id"
WHERE (form_schemas.id = fs.id
  AND fd."schemaId" IS NULL)`));

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
      .then((partial) => ((partial === false) ? null : Forms.createVersion(partial, form, true, true)));
  } else {
    work = resolve();
  }

  if (form.draftDefId != null)
    work = work.then(() =>
      Forms.getByProjectAndXmlFormId(form.projectId, form.xmlFormId, true, Form.DraftVersion)
        .then((option) => option.get()) // in transaction; guaranteed
        .then((draftForm) => draftForm.withManagedKey(key, suffix)
          .then((partial) => ((partial === false) ? null : Forms.createVersion(partial, draftForm, false, true)))));

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
        inner join (select id from roles where verbs ? 'form.read' or verbs ? 'open_form.read') as role
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
const versionJoinCondition = (version, enketoId) => {
  if (enketoId) {
    if (version != null) fatalError('Should not provide both enketoId and version; got:', { enketoId, version });
    return sql`
      form_defs."formId"=forms.id
      AND (
        form_defs."enketoId" = ${enketoId} AND form_defs.id = forms."draftDefId"
        OR (
          ( forms."enketoId" = ${enketoId} OR forms."enketoOnceId" = ${enketoId} )
          AND form_defs.id = forms."currentDefId"
        )
      )
    `;
  }

  if (version == null) fatalError('Must request a specific version or version class');
  else if (version === Form.NoDefRequired) fatalError('No JOIN should be performed if NoDefRequired');
  else if (version === '___') return versionJoinCondition('');
  else if (version === Form.AnyVersion)       return sql`form_defs.id=coalesce(forms."currentDefId", forms."draftDefId")`; // eslint-disable-line no-multi-spaces
  else if (version === Form.DraftVersion)     return sql`form_defs.id=forms."draftDefId"`; // eslint-disable-line no-multi-spaces
  else if (version === Form.PublishedVersion) return sql`form_defs.id=forms."currentDefId"`;
  else if (version === Form.AllVersions)      return sql`form_defs."formId"=forms.id  and form_defs."publishedAt" is not null`; // eslint-disable-line no-multi-spaces
  else return sql`form_defs."formId"=forms.id and form_defs.version=${version} and form_defs."publishedAt" is not null`;
};
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
const _getByActeeId = ({ forUpdate, maybeOne, acteeId, version }) => {
  const selectables = version === Form.NoDefRequired ?
    sql`* FROM forms` :
    sql`${_unjoiner.fields} FROM forms JOIN form_defs on ${versionJoinCondition(version)}`;
  const conditions = sql`
    WHERE "acteeId"=${acteeId}
      AND "deletedAt" IS NULL
  `;
  const maybeForUpdate = forUpdate ? sql`FOR UPDATE` : sql``;

  const query = sql`
    SELECT ${selectables}
      ${conditions}
      ${maybeForUpdate}
  `;

  if (version === Form.NoDefRequired) return maybeOne(query).then(map(construct(Form)));
  else return maybeOne(query).then(map(_unjoiner));
};
const getByActeeIdForUpdate = (acteeId, version) => ({ maybeOne }) => _getByActeeId({ maybeOne, acteeId, version });
const getByActeeId = (acteeId, version) => ({ maybeOne }) => _getByActeeId({ forUpdate: true, maybeOne, acteeId, version });

// there are many combinations of required fields here so we compose our own extender variant.
const _getSql = ((fields, extend, options, version, deleted = false, actorId) => {
  const { enketoId, ...condition } = options.condition;

  if (actorId) {
    if (version === Form.NoDefRequired) fatalError('Must request def when actorId is provided');
  }

  const query = sql`
    SELECT ${
      enketoId ? sql`${fields} FROM forms JOIN form_defs on ${versionJoinCondition(version, enketoId)}` :
      version === Form.NoDefRequired ? /*console.log('_getSql()', { fields }) ||*/ sql`${fields} FROM forms` :
      sql`${fields} FROM forms LEFT OUTER JOIN form_defs on ${versionJoinCondition(version)}`
    }
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
    on form_defs.id = dd."formDefId"
  left outer join
    (select public_links."formId", count(1)::integer as "publicLinks"
      from public_links
      inner join sessions on sessions."actorId" = public_links."actorId"
      group by public_links."formId") as public_link_counts
    on public_link_counts."formId" = forms.id`}
${(actorId == null) ? sql`` : sql`
inner join
  (select id, max(assignment."showDraft") as "showDraft", max(assignment."showNonOpen") as "showNonOpen" from projects
    inner join
      (select "acteeId", 0 as "showDraft", case when verbs ? 'form.read' then 1 else 0 end as "showNonOpen" from assignments
        inner join (select id, verbs from roles where verbs ? 'form.read' or verbs ? 'open_form.read') as role
          on role.id=assignments."roleId"
        where "actorId"=${actorId}
      union all
      select "acteeId", 1 as "showDraft", 1 as "showNonOpen" from assignments
        inner join (select id from roles where verbs ? 'form.update') as role
          on role.id=assignments."roleId"
        where "actorId"=${actorId}) as assignment
      on assignment."acteeId" in ('*', 'project', projects."acteeId")
    group by id) as filtered
  on filtered.id=forms."projectId"`}
where ${sqlEquals(condition)} and forms."deletedAt" is ${deleted ? sql`not` : sql``} null
${(actorId == null) ? sql`` : sql`and (form_defs."publishedAt" is not null or filtered."showDraft" = 1)`}
${(actorId == null) ? sql`` : sql`and (state != 'closed' or filtered."showNonOpen" = 1)`}
ORDER BY ${version === Form.NoDefRequired ? sql`"xmlFormId"` : sql`coalesce(form_defs.name, "xmlFormId")`} ASC`;

  // eslint-disable-next-line no-console
  console.log(`
    @@@@@@ _getSql() @@@@@@
${require('node:util').inspect(query)}
    @@@@@@@@@@@@@@@@@@@@@@@
  `);

  return query;
});

const _get = (exec, options, xml, version, deleted, actorId) => {
  const frames = [ Form ];
  if (version !== Form.NoDefRequired) frames.push(Form.Def);
  if (xml === true) frames.push(Form.Xml);
  return extender(...frames)(Form.Extended, Actor.into('createdBy'))(_getSql)(exec, options, version, deleted, actorId);
};

const getByProjectId = (auth, projectId, xml, version, options = QueryOptions.none, deleted = false) => ({ all }) =>
  _get(all, options.withCondition({ projectId }), xml, version, deleted, auth.actor.map((actor) => actor.id).orElse(-1));
const getByProjectAndXmlFormId = (projectId, xmlFormId, xml, version, options = QueryOptions.none, deleted = false) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ projectId, xmlFormId }), xml, version, deleted);
const getByEnketoId = (enketoId, xml, version, options = QueryOptions.none, deleted = false) =>
  ({ maybeOne }) => _get(maybeOne, options.withCondition({ enketoId }), xml, version, deleted);

const getByProjectAndNumericId = (projectId, id, xml, version, options = QueryOptions.none, deleted = false) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ projectId, 'forms.id': id }), xml, version, deleted);
const getAllByAuth = (auth, options = QueryOptions.none) => ({ all }) =>
  _get(all, options, null, null, false, auth.actor.map((actor) => actor.id).orElse(-1));

////////////////////////////////////////////////////////////////////////////////
// SCHEMA

const getFields = (formDefId) => ({ all }) =>
  all(sql`SELECT form_fields.* FROM form_fields
  JOIN form_schemas ON form_schemas."id" = form_fields."schemaId"
  JOIN form_defs ON form_schemas."id" = form_defs."schemaId"
  WHERE form_defs."id"=${formDefId} ORDER BY form_fields."order" ASC`)
    .then(map(construct(Form.Field)));

const getBinaryFields = (formDefId) => ({ all }) =>
  all(sql`SELECT form_fields.* FROM form_fields
  JOIN form_schemas ON form_schemas."id" = form_fields."schemaId"
  JOIN form_defs ON form_schemas."id" = form_defs."schemaId"
  WHERE form_defs."id"=${formDefId} AND form_fields."binary"=true
  ORDER BY form_fields."order" ASC`)
    .then(map(construct(Form.Field)));

const getStructuralFields = (formDefId) => ({ all }) =>
  all(sql`select form_fields.* from form_fields
  join form_schemas ON form_schemas."id" = form_fields."schemaId"
  join form_defs ON form_schemas."id" = form_defs."schemaId"
  WHERE form_defs."id"=${formDefId} AND (form_fields.type='repeat' OR form_fields.type='structure')
  ORDER BY form_fields."order" ASC`)
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
join form_schemas on form_fields."schemaId" = form_schemas."id"
inner join
  (select distinct "schemaId" from form_defs where "publishedAt" is not null)
  as defs on defs."schemaId"=form_schemas."id"
where form_fields."formId"=${formId}
order by "schemaId" asc, "order" asc`)
  .then(map(construct(Form.Field)))
  .then((fields) => {
    // first, partition the fields into different versions.
    const versions = [];
    let mark = 0;
    for (let idx = 1; idx < fields.length; idx += 1) {
      if (fields[idx].schemaId !== fields[idx - 1].schemaId) {
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

////////////////////////////////////////////////////////////////////////////////
// CHECKING CONSTRAINTS, STRUCTURAL CHANGES, ETC.

// This will check if a form contains a meta group (for capturing instanceID).
// It is only to be used for newly uploaded forms.
const checkMeta = (fields) => () =>
  (fields.some((f) => (f.name === 'meta' && f.type === 'structure'))
    ? resolve()
    : reject(Problem.user.missingMeta()));

const checkDeletedForms = (xmlFormId, projectId) => ({ maybeOne, context }) => (context.query.ignoreWarnings ? resolve() : maybeOne(sql`SELECT 1 FROM forms WHERE "xmlFormId" = ${xmlFormId} AND "projectId" = ${projectId} AND "deletedAt" IS NOT NULL LIMIT 1`)
  .then(deletedForm => {
    if (deletedForm.isDefined()) {
      if (!context.transitoryData.has('workflowWarnings')) context.transitoryData.set('workflowWarnings', []);
      context.transitoryData.get('workflowWarnings').push({ type: 'deletedFormExists', details: { xmlFormId } });
    }
  }));

const checkDatasetWarnings = (dataset) => ({ context }) => {
  if (context.query.ignoreWarnings) return resolve();

  if (dataset.isDefined() && dataset.get().warnings != null) {
    if (!context.transitoryData.has('workflowWarnings')) context.transitoryData.set('workflowWarnings', []);
    context.transitoryData.get('workflowWarnings').push(...dataset.get().warnings);
  }
  return resolve();
};

const checkStructuralChange = (existingFields, fields) => ({ context }) => {
  if (context.query.ignoreWarnings) return resolve();

  const newFieldSet = new Set(fields.map(f => f.path));
  const removedFields = existingFields.filter(f => !newFieldSet.has(f.path));

  if (removedFields.length > 0) {
    if (!context.transitoryData.has('workflowWarnings')) context.transitoryData.set('workflowWarnings', []);
    context.transitoryData.get('workflowWarnings').push({ type: 'structureChanged', details: removedFields.map(f => f.name) });
  }
  return resolve();
};

const rejectIfWarnings = () => ({ context }) => {
  const warnings = {};

  if (context.transitoryData.has('xlsFormWarnings')) {
    warnings.xlsFormWarnings = context.transitoryData.get('xlsFormWarnings');
  }

  if (context.transitoryData.has('workflowWarnings')) {
    warnings.workflowWarnings = context.transitoryData.get('workflowWarnings');
  }

  if (warnings.xlsFormWarnings || warnings.workflowWarnings) {
    return reject(Problem.user.formWarnings({ warnings }));
  } else {
    return resolve();
  }
};

// This function replaces a database trigger called check_field_collisions that
// prevents certain kinds of field type changes and downcasts.
// - Most types can be downcast to a string, but they cannot change between non-string types.
//    e.g. A date can become a string, but a string can't become a date, int, etc. because if
//    the data in that string is not a valid date/int, it will cause problems when exporting.
// - A group or repeat cannot be downcast to a string.
const checkFieldDowncast = (allFields, fields) => () => {
  const lookup = {};
  for (const f of allFields) lookup[f.path] = f;
  for (const f of fields) {
    // If new field type is not a string, types must stay the same
    if (f.type !== 'string' && lookup[f.path] && f.type !== lookup[f.path].type)
      return reject(Problem.user.fieldTypeConflict({ path: f.path, type: lookup[f.path].type }));
    // Downcasting to string is only allowed if not group/structure or repeat.
    if (f.type === 'string' && lookup[f.path] && (lookup[f.path].type === 'structure' || lookup[f.path].type === 'repeat'))
      return reject(Problem.user.fieldTypeConflict({ path: f.path, type: lookup[f.path].type }));
  }
  return resolve();
};

const _newSchema = () => ({ one }) =>
  one(sql`insert into form_schemas (id) values (default) returning *`)
    .then((s) => s.id);

module.exports = {
  fromXls, pushDraftToEnketo, pushFormToEnketo,
  _insertFormFields,
  _createNew, createNew, _createNewDef, createVersion,
  publish, clearDraft,
  _update, update, _updateDef, replaceDef, del, restore, purge,
  clearUnneededDrafts,
  setManagedKey,
  getByAuthForOpenRosa,
  getVersions, getByActeeIdForUpdate, getByActeeId,
  getByProjectId, getByProjectAndXmlFormId, getByEnketoId, getByProjectAndNumericId,
  getAllByAuth,
  getFields, getBinaryFields, getStructuralFields, getMergedFields,
  rejectIfWarnings, checkMeta, checkDeletedForms, checkStructuralChange, checkFieldDowncast, checkDatasetWarnings,
  _newSchema,
  lockDefs, getAllSubmitters
};

