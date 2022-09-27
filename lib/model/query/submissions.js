// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { sql } = require('slonik');
const { Frame, table } = require('../frame');
const { Actor, Form, Submission } = require('../frames');
const { odataFilter } = require('../../data/odata-filter');
const { unjoiner, extender, equals, page, updater, QueryOptions, insertMany } = require('../../util/db');
const { blankStringToNull, construct } = require('../../util/util');
const Problem = require('../../util/problem');


////////////////////////////////////////////////////////////////////////////////
// SUBMISSION CREATE

const _defInsert = (id, partial, formDefId, actorId, root, deviceId, userAgent) => sql`insert into submission_defs ("submissionId", xml, "formDefId", "instanceId", "instanceName", "submitterId", "localKey", "encDataAttachmentName", "signature", "createdAt", root, current, "deviceId", "userAgent")
  values (${id}, ${sql.binary(partial.xml)}, ${formDefId}, ${partial.instanceId}, ${partial.def.instanceName}, ${actorId}, ${partial.def.localKey}, ${partial.def.encDataAttachmentName}, ${partial.def.signature}, clock_timestamp(), ${root}, true, ${deviceId}, ${userAgent})
  returning *`;
const nextval = sql`nextval(pg_get_serial_sequence('submissions', 'id'))`;

// creates both the submission and its initial submission def in one go.
const createNew = (partial, form, deviceIdIn = null, userAgentIn = null) => ({ one, context }) => {
  const actorId = context.auth.actor.map((actor) => actor.id).orNull();
  const deviceId = blankStringToNull(deviceIdIn);
  const userAgent = blankStringToNull(userAgentIn);

  return one(sql`
with def as (${_defInsert(nextval, partial, form.def.id, actorId, true, deviceId, userAgent)}),
ins as (insert into submissions (id, "formId", "instanceId", "submitterId", "deviceId", draft, "createdAt")
  select def."submissionId", ${form.id}, ${partial.instanceId}, def."submitterId", ${deviceId}, ${form.def.publishedAt == null}, def."createdAt" from def
  returning submissions.*)
select ins.*, def.id as "submissionDefId" from ins, def;`)
    .then(({ submissionDefId, ...submissionData }) => // TODO/HACK: reassembling this from bits and bobs.
      new Submission(submissionData, {
        def: new Submission.Def({
          id: submissionDefId,
          submissionId: submissionData.id,
          formDefId: form.def.id,
          submitterId: submissionData.submitterId,
          localKey: partial.def.localKey,
          encDataAttachmentName: partial.def.encDataAttachmentName,
          signature: partial.def.signature,
          createdAt: submissionData.createdAt
        }),
        xml: new Submission.Xml({ xml: partial.xml })
      }));
};

createNew.audit = (submission, _, form) => (log) =>
  log('submission.create', form, { submissionId: submission.id, instanceId: submission.instanceId });
createNew.audit.withResult = true;
createNew.audit.logEvenIfAnonymous = true; // so that test submissions are fully logged.

const createVersion = (partial, deprecated, form, deviceIdIn = null, userAgentIn = null) => ({ one, context }) => {
  const actorId = context.auth.actor.map((actor) => actor.id).orNull();
  const deviceId = blankStringToNull(deviceIdIn);
  const userAgent = blankStringToNull(userAgentIn);

  // we already do transactions but it just feels nice to have the cte do it all at once.
  return one(sql`
with logical as (update submissions set "reviewState"='edited', "updatedAt"=clock_timestamp()
  where id=${deprecated.submissionId})
, upd as (update submission_defs set current=false where "submissionId"=${deprecated.submissionId})
${_defInsert(deprecated.submissionId, partial, form.def.id, actorId, null, deviceId, userAgent)}`)
    // TODO/HACK: lame that we are reconstructing this this way.
    .then((saved) => new Submission({ instanceId: partial.instanceId },
      { def: new Submission.Def(saved), xml: new Submission.Xml({ xml: partial.xml }) }));
};

createVersion.audit = (partial, deprecated, form) => (log) =>
  log('submission.update.version', form, { submissionId: deprecated.submissionId, instanceId: partial.instanceId });
createVersion.audit.logEvenIfAnonymous = true; // so that test submissions are fully logged.


////////////////////////////////////////////////////////////////////////////////
// SUBMISSION MANAGEMENT

const update = (form, submission, data) => ({ one }) => one(updater(submission, data)).then(construct(Submission));
update.audit = (form, submission, data) => (log) => log('submission.update', form, Object.assign({ submissionId: submission.id, submissionDefId: submission.def.id }, data));

const clearDraftSubmissions = (formId) => ({ run }) =>
  run(sql`delete from submissions where "formId"=${formId} and draft=true`);


////////////////////////////////////////////////////////////////////////////////
// SELECT-MULTIPLE VALUES

// takes pairs data in the format put out by getSelectManyResponses:
// { '/path/to/field': Set[string values], ... }
const setSelectMultipleValues = (formId, submissionDefId, pairs) => ({ run }) => {
  const inserts = [];
  for (const path of Object.keys(pairs))
    for (const value of pairs[path].values())
      inserts.push(new Form.FieldValue({ formId, submissionDefId, path, value }));
  return run(sql`
    with del as (delete from form_field_values where "submissionDefId"=${submissionDefId})
    ${insertMany(inserts)}`);
};

const getSelectMultipleValuesForExport = (formId, draft, options) => ({ all }) => all(sql`
select path, value from form_field_values
inner join
  (select id, "submissionId" from submission_defs
    where current=true and "localKey" is null) as defs
  on defs.id=form_field_values."submissionDefId"
inner join
  (select * from submissions
    where "deletedAt" is null and draft=${draft}) as submissions
  on submissions.id=defs."submissionId"
where
  form_field_values."formId"=${formId} and
  ${odataFilter(options.filter)}
group by path, value
order by path asc, value asc`)
  .then((values) => {
    const result = {};
    for (const { path, value } of values) {
      if (result[path] == null) result[path] = [];
      result[path].push(value);
    }
    return result;
  });



////////////////////////////////////////////////////////////////////////////////
// SUBMISSION GETTERS

const _get = extender(Submission)(Actor.into('submitter'))((fields, extend, options, projectId, xmlFormId, draft) => sql`
select ${fields} from submissions
join forms on forms."xmlFormId"=${xmlFormId} and forms.id=submissions."formId"
join projects on projects.id=${projectId} and projects.id=forms."projectId"
${extend|| sql`left outer join actors on actors.id=submissions."submitterId"`}
where ${equals(options.condition)} and draft=${draft} and submissions."deletedAt" is null
order by submissions."createdAt" desc, submissions.id desc
${page(options)}`);

const getByIds = (projectId, xmlFormId, instanceId, draft, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ instanceId }), projectId, xmlFormId, draft);

const getAllForFormByIds = (projectId, xmlFormId, draft, options = QueryOptions.none) => ({ all }) =>
  _get(all, options, projectId, xmlFormId, draft);

const getById = (submissionId) => ({ maybeOne }) =>
  maybeOne(sql`select * from submissions where id=${submissionId} and "deletedAt" is null`)
    .then(map(construct(Submission)));

const countByFormId = (formId, draft, options = QueryOptions.none) => ({ oneFirst }) => oneFirst(sql`
select count(*) from submissions
  where ${equals({ formId, draft })} and "deletedAt" is null and ${odataFilter(options.filter)}`);

const verifyVersion = (formId, rootId, instanceId, draft) => ({ maybeOne }) => maybeOne(sql`
select true from submissions
join submission_defs on submission_defs."submissionId"=submissions.id
where submissions."instanceId"=${rootId} and submission_defs."instanceId"=${instanceId}
  and submissions."formId"=${formId} and draft=${draft} and "deletedAt" is null`)
  .then((o) => o.orElseGet(() => { throw Problem.user.notFound(); }));


////////////////////////////////////////////////////////////////////////////////
// SUBMISSION DEF GETTERS

const getByIdsWithDef = (projectId, xmlFormId, instanceId, draft) => ({ maybeOne }) => maybeOne(sql`
select submissions.*, submission_defs.id as "defId" from submission_defs
inner join submissions
  on submissions.id=submission_defs."submissionId"
inner join
  (select id from forms
    where "projectId"=${projectId} and "xmlFormId"=${xmlFormId} and "deletedAt" is null) as forms
  on forms.id=submissions."formId"
where submissions."instanceId"=${instanceId}
  and submissions."deletedAt" is null
  and draft=${draft}
  and submission_defs.current=true`)
  .then(map((row) => new Submission.Partial(row, { def: new Submission.Def({ id: row.defId }) })));

const getCurrentDefByIds = (projectId, xmlFormId, instanceId, draft) => ({ maybeOne }) => maybeOne(sql`
select submission_defs.* from submission_defs
inner join
  (select submissions.id, "instanceId" from submissions
    inner join
      (select id from forms
        where "projectId"=${projectId} and "xmlFormId"=${xmlFormId} and "deletedAt" is null) as forms
      on forms.id=submissions."formId"
    where submissions."deletedAt" is null and draft=${draft}) as submissions
  on submissions.id=submission_defs."submissionId"
where submissions."instanceId"=${instanceId} and current=true
limit 1`)
  .then(map(construct(Submission.Def)));

const getDefById = (submissionDefId) => ({ maybeOne }) => maybeOne(sql`
select submission_defs.* from submission_defs
inner join submissions on submissions.id = submission_defs."submissionId" and submissions."deletedAt" is null
where submission_defs.id=${submissionDefId}`)
  .then(map(construct(Submission.Def)));

const _getDef = extender(Submission.Def)(Actor.into('submitter'), Submission.Extended)((fields, extend, options, formId, draft) => sql`
select ${fields} from submission_defs
inner join
  (select id, "instanceId" from submissions where "formId"=${formId} and draft=${draft} and "deletedAt" is null)
  as submissions on submissions.id=submission_defs."submissionId"
${extend|| sql`
  left outer join actors on actors.id=submission_defs."submitterId"
  inner join (select id, version as "formVersion" from form_defs) as fds
    on fds.id=submission_defs."formDefId"`}
where ${equals(options.condition)}
order by submission_defs.id desc`);

const getAnyDefByFormAndInstanceId = (formId, instanceId, draft, options = QueryOptions.none) => ({ maybeOne }) =>
  _getDef(maybeOne, options.withCondition({ 'submission_defs.instanceId': instanceId }), formId, draft);

const getDefsByFormAndLogicalId = (formId, instanceId, draft, options = QueryOptions.none) => ({ all }) =>
  _getDef(all, options.withCondition({ 'submissions.instanceId': instanceId }), formId, draft);

const getDefBySubmissionAndInstanceId = (submissionId, instanceId) => ({ maybeOne }) => maybeOne(sql`
select * from submission_defs
where "submissionId"=${submissionId} and "instanceId"=${instanceId}`)
  .then(map(construct(Submission.Def)));

const getRootForInstanceId = (formId, instanceId, draft) => ({ maybeOne }) => maybeOne(sql`
select submissions."instanceId" from submissions
join submission_defs on submission_defs."instanceId"=${instanceId}
  and submission_defs."submissionId"=submissions.id
where "formId"=${formId} and draft=${draft} and submissions."deletedAt" is null`)
  .then(map((row) => row.instanceId));


////////////////////////////////////////////////////////////////////////////////
// EXPORT

const _exportUnjoiner = unjoiner(Submission, Submission.Def, Submission.Xml, Submission.Encryption,
  Actor.alias('actors', 'submitter'), Frame.define(table('attachments'), 'present', 'expected'),
  Frame.define(table('edits'), 'count'), Submission.Exports); // TODO: figure out how to combine some of these

// TODO: this is a terrible hack to add some logic to one of our select fields. this is
// the /only/ place we need to do this in the entire codebase right now. so for now
// we just use the terrible hack.
const { raw } = require('slonik-sql-tag-raw');
const _exportFields = raw(_exportUnjoiner.fields.sql.replace(
  'submission_defs."xml" as "submission_defs!xml"',
  '(case when submission_defs."localKey" is null then submission_defs.xml end) as "submission_defs!xml"'
));

const _export = (formId, draft, keyIds = [], options) => {
  const encrypted = keyIds.length !== 0;
  return sql`
select ${_exportFields} from submission_defs
inner join (select * from submissions where draft=${draft}) as submissions
  on submissions.id=submission_defs."submissionId"
left outer join actors on submissions."submitterId"=actors.id
left outer join
  (select *, index as "encIndex",
      (submission_attachments."blobId" is not null) as "encHasData"
    from submission_attachments)
    as submission_attachments
  on submission_attachments."submissionDefId"=submission_defs.id
    and submission_attachments.name=submission_defs."encDataAttachmentName"
left outer join
  (select "submissionDefId", count("blobId")::integer as present, count(name)::integer as expected
    from submission_attachments
    group by "submissionDefId") as attachments
  on attachments."submissionDefId"=submission_defs.id
inner join (select "formDefId", "submissionId" from submission_defs where root is true) as roots
  on roots."submissionId"=submission_defs."submissionId"
inner join (select id, version as "formVersion" from form_defs) as fds
  on fds.id=roots."formDefId"
${encrypted ? sql`
left outer join (select id, "keyId" as "encKeyId" from form_defs) as form_defs on form_defs.id=submission_defs."formDefId"
left outer join (select id, content as "encData" from blobs) as blobs on blobs.id=submission_attachments."blobId"`
    : sql`join (select null as "encKeyId", null as "encData") as enc on true`}
inner join
  (select "submissionId", (count(id) - 1) as count from submission_defs
    group by "submissionId") as edits
  on edits."submissionId"=submission_defs."submissionId"
where
  ${encrypted ? sql`(form_defs."encKeyId" is null or form_defs."encKeyId" in (${sql.join(keyIds, sql`,`)})) and` : sql``}
  ${odataFilter(options.filter)} and
  ${equals(options.condition)}
  and submission_defs.current=true and submissions."formId"=${formId} and submissions."deletedAt" is null
order by submissions."createdAt" desc, submissions.id desc
${page(options)}`;
};

const streamForExport = (formId, draft, keyIds, options = QueryOptions.none) => ({ stream }) =>
  stream(_export(formId, draft, keyIds, options))
    .then(stream.map(_exportUnjoiner));

const getForExport = (formId, instanceId, draft, options = QueryOptions.none) => ({ maybeOne }) =>
  maybeOne(_export(formId, draft, [], options.withCondition({ 'submissions.instanceId': instanceId })))
    .then(map(_exportUnjoiner));


module.exports = {
  createNew, createVersion,
  update, clearDraftSubmissions,
  setSelectMultipleValues, getSelectMultipleValuesForExport,
  getByIdsWithDef,
  getByIds, getAllForFormByIds, getById, countByFormId, verifyVersion,
  getDefById, getCurrentDefByIds, getAnyDefByFormAndInstanceId, getDefsByFormAndLogicalId, getDefBySubmissionAndInstanceId, getRootForInstanceId,
  streamForExport, getForExport
};

