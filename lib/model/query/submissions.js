// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable key-spacing, no-multi-spaces */

const { always, equals, identity, ifElse, map, pick, without } = require('ramda');
const { sql } = require('slonik');
const { Frame, table } = require('../frame');
const { Actor, Form, Submission } = require('../frames');
const { odataFilter, odataOrderBy, odataExcludeDeleted } = require('../../data/odata-filter');
const { odataToColumnMap, odataSubTableToColumnMap } = require('../../data/submission');
const { unjoiner, extender, sqlEquals, page, updater, QueryOptions, insertMany, markDeleted, markUndeleted, sqlInArray } = require('../../util/db');
const { blankStringToNull, construct, truncateString, applyPipe } = require('../../util/util');
const Problem = require('../../util/problem');
const { streamEncBlobs } = require('../../util/blob');
const { PURGE_DAY_RANGE } = require('../../util/constants');
const { isTrue } = require('../../util/http');

////////////////////////////////////////////////////////////////////////////////
// SUBMISSION CREATE

// creates both the submission and its initial submission def in one go.
const createNew = (partial, form, deviceIdIn = null, userAgentIn = null) => ({ one, context }) => {
  const actorId = context.auth.actor.map((actor) => actor.id).orNull();
  const deviceId = applyPipe(deviceIdIn, truncateString(255), blankStringToNull);
  const userAgent = applyPipe(userAgentIn, truncateString(255), blankStringToNull);

  return one(sql`
    WITH
      newSubmission AS (
        INSERT INTO submissions ("formId", "instanceId", "submitterId", "deviceId", draft, "createdAt")
          VALUES(${form.id}, ${partial.instanceId}, ${actorId}, ${deviceId}, ${form.def.isDraft()}, clock_timestamp())
        RETURNING *
      ),
      newDef AS (
        INSERT INTO submission_defs ("submissionId", xml, "formDefId", "instanceId", "instanceName", "submitterId", "localKey", "encDataAttachmentName", signature, "createdAt", root, current, "deviceId", "userAgent")
          SELECT newSubmission.id AS "submissionId", ${sql.binary(partial.xml)}, ${form.def.id}, "instanceId", ${partial.def.instanceName}, "submitterId", ${partial.def.localKey}, ${partial.def.encDataAttachmentName}, ${partial.def.signature}, "createdAt", true, true, "deviceId", ${userAgent}
            FROM newSubmission
        RETURNING id
      )
    SELECT newSubmission.id
         , newSubmission."createdAt"
         , newDef.id AS "submissionDefId"
      FROM newSubmission
      CROSS JOIN newDef
  `)
    .then(({ id, createdAt, submissionDefId }) =>
      new Submission({
        id,
        instanceId: partial.instanceId,
        submitterId: actorId,
        deviceId,
        createdAt,
        updatedAt: null,
        userAgent,
      }, {
        def: new Submission.Def({
          id: submissionDefId,
          submissionId: id,
          formDefId: form.def.id,
          submitterId: actorId,
          localKey: partial.def.localKey,
          encDataAttachmentName: partial.def.encDataAttachmentName,
          signature: partial.def.signature,
          createdAt,
          userAgent
        }),
        currentVersion: new Submission.Def({
          instanceId: partial.instanceId,
          createdAt,
          deviceId,
          userAgent,
          instanceName: partial.def.instanceName,
          current: true,
          submitterId: actorId,
        }),
        xml: new Submission.Xml({ xml: partial.xml })
      }));
};

createNew.audit = (submission, _, form) => (log) =>
  log('submission.create', form, {
    submissionId: submission.id,
    instanceId: submission.instanceId,
    submissionDefId: submission.def.id // added in v2023.3; not backfilled.
  });
createNew.audit.withResult = true;
createNew.audit.logEvenIfAnonymous = true; // so that test submissions are fully logged.

const createVersion = (partial, deprecated, form, deviceIdIn = null, userAgentIn = null) => ({ one, context }) => {
  const actorId = context.auth.actor.map((actor) => actor.id).orNull();
  const deviceId = applyPipe(deviceIdIn, truncateString(255), blankStringToNull);
  const userAgent = applyPipe(userAgentIn, truncateString(255), blankStringToNull);

  // we already do transactions but it just feels nice to have the cte do it all at once.
  return one(sql`
    WITH
      updatedSubmission AS (
        UPDATE submissions
          SET "reviewState"='edited'
            , "updatedAt"=clock_timestamp()
          WHERE id=${deprecated.submissionId}
        RETURNING *
      ),
      deprecatedDef AS (
        UPDATE submission_defs
          SET current = FALSE
          WHERE "submissionId"=${deprecated.submissionId}
            AND current IS TRUE
      ),
      newDef AS (
        INSERT INTO submission_defs ("submissionId", xml, "formDefId", "instanceId", "instanceName", "submitterId", "localKey", "encDataAttachmentName", "signature", "createdAt", root, current, "deviceId", "userAgent")
          VALUES (${deprecated.submissionId}, ${sql.binary(partial.xml)}, ${form.def.id}, ${partial.instanceId}, ${partial.def.instanceName}, ${actorId}, ${partial.def.localKey}, ${partial.def.encDataAttachmentName}, ${partial.def.signature}, clock_timestamp(), null, true, ${deviceId}, ${userAgent})
          RETURNING id AS "submissionDefId", "createdAt" as "submissionDefCreatedAt"
      )
    SELECT updatedSubmission.*
         , submission_defs."userAgent"
         , newDef.*
      FROM updatedSubmission
      JOIN submission_defs
        ON "submissionId"=${deprecated.submissionId} AND root IS TRUE
      CROSS JOIN newDef
  `)
    .then(({ submissionDefId, submissionDefCreatedAt, ...submissionData }) =>
      new Submission({ id: deprecated.submissionId, ...submissionData }, {
        currentVersion: new Submission.Def({
          id:                    submissionDefId,
          submissionId:          deprecated.submissionId,
          formDefId:             form.def.id,
          submitterId:           actorId,
          localKey:              partial.def.localKey,
          encDataAttachmentName: partial.def.encDataAttachmentName,
          signature:             partial.def.signature,
          createdAt:             submissionDefCreatedAt,
          instanceName:          partial.def.instanceName,
          instanceId:            partial.instanceId,
          current:               true,
          xml:                   partial.xml.toString(),
          root:                  null,
          deviceId,
          userAgent,
        }),
      }));
};

createVersion.audit = (submission, partial, deprecated, form) => (log) =>
  log('submission.update.version', form, {
    submissionId: deprecated.submissionId,
    instanceId: partial.instanceId,
    submissionDefId: submission.aux.currentVersion.id // added in v2023.3; not backfilled.
  });
createVersion.audit.logEvenIfAnonymous = true; // so that test submissions are fully logged.
createVersion.audit.withResult = true;

////////////////////////////////////////////////////////////////////////////////
// SUBMISSION MANAGEMENT

const update = (form, submission, data) => ({ one }) => one(updater(submission, data)).then(construct(Submission));
update.audit = (form, submission, data) => (log) => log('submission.update', form, Object.assign({ submissionId: submission.id, submissionDefId: submission.def.id, instanceId: submission.instanceId }, data));

const clearDraftSubmissionsForProject = (projectId) => ({ run }) =>
  run(sql`DELETE FROM submissions USING forms WHERE submissions."formId" = forms.id AND forms."projectId" = ${projectId} AND submissions.draft=true`);

const deleteDraftSubmissions = (formId) => ({ run }) =>
  run(sql`UPDATE submissions SET "deletedAt"=now() WHERE "formId"=${formId} AND "draft"=true AND "deletedAt" IS NULL`);

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
  ${odataFilter(options.filter, odataToColumnMap)}
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

// Helper function to assign submission.currentVersionSubmitter to submission.currentVersion.submitter
// Current there is no way to create such complex object using `extender` and `unjoiner` framework functions
//
// New instance of Submission is created to remove all aux objects from it (except submitter).
// If those aux's are kept then properties of aux are merged at the root level cb#858
const assignCurrentVersionSubmitter = (x) => (new Submission(x, { submitter: x.aux.submitter })).withAux('currentVersion', x.aux.currentVersion.withAux('submitter', x.aux.currentVersionSubmitter));

const _get = extender(Submission, Submission.Def.into('currentVersion'))(Actor.into('submitter'), Actor.alias('current_version_actors', 'currentVersionSubmitter'))((fields, extend, options, projectId, xmlFormId, draft, deleted = false) => sql`
  select ${fields} from 
  (
    select submissions.*, submission_defs."userAgent" from submissions
    join submission_defs on submissions.id = submission_defs."submissionId" and root
  ) submissions
  join submission_defs on submissions.id = submission_defs."submissionId" and submission_defs.current
  join forms on forms."xmlFormId"=${xmlFormId} and forms.id=submissions."formId" and forms."projectId"=${projectId}
  ${extend|| sql`
    left outer join actors on actors.id=submissions."submitterId"
    left outer join actors current_version_actors on current_version_actors.id=submission_defs."submitterId"
  `}
  where ${sqlEquals(options.condition)} and draft=${draft} AND submissions."deletedAt" IS ${deleted ? sql`NOT` : sql``} NULL
  order by submissions."createdAt" desc, submissions.id desc
  ${page(options)}`);

const getByIds = (projectId, xmlFormId, instanceId, draft, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ 'submissions.instanceId': instanceId }), projectId, xmlFormId, draft)
    .then(x => x.map(assignCurrentVersionSubmitter));

const getAllForFormByIds = (projectId, xmlFormId, draft, options = QueryOptions.none) => ({ all }) =>
  _get(all, options, projectId, xmlFormId, draft, isTrue(options.argData.deleted))
    .then(map(assignCurrentVersionSubmitter));

const getById = (submissionId) => ({ maybeOne }) =>
  maybeOne(sql`select * from submissions where id=${submissionId} and "deletedAt" is null`)
    .then(map(construct(Submission)));

const getDeleted = (projectId, formId, instanceId) => ({ maybeOne }) =>
  maybeOne(sql`  select submissions.*
  from submissions
  join forms on submissions."formId" = forms.id
  where forms."projectId" = ${projectId}
    and submissions."formId" = ${formId}
    and submissions."instanceId" = ${instanceId}
    and submissions."deletedAt" IS NOT NULL
    and submissions."draft" = false
`)
    .then(map(construct(Submission)));

const joinOnSkiptoken = (skiptoken, formId, draft) => {
  if (skiptoken == null) return sql``;
  // In the case of a subtable, we fetch all submissions without pagination: we
  // don't use $skiptoken in the query, only in application code.
  if (skiptoken.repeatId != null) return sql``;
  // If the submission associated with the $skiptoken has been deleted but not
  // purged, we should still be able to use the $skiptoken. Because of that, we
  // don't filter on "deletedAt".
  return sql`INNER JOIN (
  SELECT id, "createdAt"
  FROM submissions
  WHERE ${sqlEquals({ formId, draft })} AND "instanceId" = ${skiptoken.instanceId}
) AS cursor ON
  submissions."createdAt" < cursor."createdAt" OR
  (submissions."createdAt" = cursor."createdAt" AND submissions.id < cursor.id)`;
};

const countByFormId = (formId, draft, options = QueryOptions.none) => ({ one }) => {
  const filter = sql`${sqlEquals({ formId, draft })} AND
${odataExcludeDeleted(options.filter, odataToColumnMap)} AND
${odataFilter(options.filter, odataToColumnMap)}`;
  return one(sql`
SELECT * FROM
( SELECT COUNT(*) count FROM submissions WHERE ${filter}) AS "all"
CROSS JOIN
( SELECT COUNT(*) remaining FROM submissions
  ${joinOnSkiptoken(options.skiptoken, formId, draft)}
  WHERE ${filter}) AS skiptoken
`);
};

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
  .then(map((row) => new Submission(row, { def: new Submission.Def({ id: row.defId }) })));

const _buildGetCurrentSql = (cols, projectId, xmlFormId, instanceId, draft) => sql`
select ${cols} from submission_defs
inner join
  (select submissions.id, "instanceId" from submissions
    inner join
      (select id from forms
        where "projectId"=${projectId} and "xmlFormId"=${xmlFormId} and "deletedAt" is null) as forms
      on forms.id=submissions."formId"
    where submissions."deletedAt" is null and draft=${draft}) as submissions
  on submissions.id=submission_defs."submissionId"
where submissions."instanceId"=${instanceId} and current=true
limit 1`;

const getCurrentDefColByIds = (col, projectId, xmlFormId, instanceId, draft) => ({ maybeOneFirst }) =>
  maybeOneFirst(_buildGetCurrentSql(sql.identifier(['submission_defs', col]), projectId, xmlFormId, instanceId, draft));

const getCurrentDefColsByIds = (cols, projectId, xmlFormId, instanceId, draft) => ({ maybeOne }) =>
  maybeOne(_buildGetCurrentSql(sql.join(cols.map(col => sql.identifier(['submission_defs', col])), sql`,`), projectId, xmlFormId, instanceId, draft));

const getCurrentDefByIds = (projectId, xmlFormId, instanceId, draft) => ({ maybeOne }) =>
  maybeOne(_buildGetCurrentSql(sql`submission_defs.*`, projectId, xmlFormId, instanceId, draft))
    .then(map(construct(Submission.Def)));

const getDefById = (submissionDefId) => ({ maybeOne }) => maybeOne(sql`
select submission_defs.* from submission_defs
inner join submissions on submissions.id = submission_defs."submissionId" and submissions."deletedAt" is null
where submission_defs.id=${submissionDefId}`)
  .then(map(construct(Submission.Def)));

const _subAndDefUnjoiner = unjoiner(Submission, Submission.Def);
const getSubAndDefById = (submissionDefId) => ({ maybeOne }) => maybeOne(sql`
SELECT ${_subAndDefUnjoiner.fields} FROM submission_defs
JOIN (
  SELECT *, '' "userAgent" FROM submissions
) submissions ON submissions.id = submission_defs."submissionId" AND submissions."deletedAt" IS NULL
WHERE submission_defs.id=${submissionDefId}`)
  .then(map(_subAndDefUnjoiner));

const _getDef = extender(Submission.Def)(Actor.into('submitter'), Submission.Extended)((fields, extend, options, formId, draft) => sql`
select ${fields} from submission_defs
inner join
  (select id, "instanceId" from submissions where "formId"=${formId} and draft=${draft} and "deletedAt" is null)
  as submissions on submissions.id=submission_defs."submissionId"
${extend|| sql`
  left outer join actors on actors.id=submission_defs."submitterId"
  inner join (select id, version as "formVersion" from form_defs) as fds
    on fds.id=submission_defs."formDefId"`}
where ${sqlEquals(options.condition)}
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

const defExists = (formId, submissionInstanceId, versionInstanceId = null) => (db) => db.oneFirst(
  sql`SELECT EXISTS(
    SELECT 1
    FROM submissions sub
    INNER JOIN submission_defs def ON (
      sub."deletedAt" IS NULL
      AND
      (sub."formId", sub.id, sub."instanceId", def."instanceId") = (${formId}, def."submissionId", ${submissionInstanceId}, ${(versionInstanceId || submissionInstanceId)})
    )
  )`
);

////////////////////////////////////////////////////////////////////////////////
// EXPORT

const _exportUnjoiner = unjoiner(Submission, Submission.Def, Submission.Xml, Submission.Encryption,
  Actor.alias('actors', 'submitter'), Frame.define(table('attachments'), 'present', 'expected'),
  Frame.define(table('edits'), 'count'), Submission.Exports); // TODO: figure out how to combine some of these

// TODO: this is a terrible hack to add some logic to one of our select fields. this is
// the /only/ place we need to do this in the entire codebase right now. so for now
// we just use the terrible hack.
const xmlUnlessEncrypted = {
  name: 'xml',
  selectSql: tableAlias => sql`(case when ${sql.identifier([tableAlias, 'localKey'])} is null then ${sql.identifier([tableAlias, 'xml'])} end)`,
};
const cloneFrame = (frame, fieldMutator) => ({ ...pick(['from', 'to'], frame), fields: fieldMutator(frame.fields) });
const ExportSubmission = cloneFrame(Submission, without(['userAgent']));
const ExportSubmissionDef = cloneFrame(Submission.Def, map(ifElse(equals('xml'), always(xmlUnlessEncrypted), identity)));
const _exportFields = unjoiner(ExportSubmission, ExportSubmissionDef, Submission.Xml, Submission.Encryption,
  Actor.alias('actors', 'submitter'), Frame.define(table('attachments'), 'present', 'expected'),
  Frame.define(table('edits'), 'count'), Submission.Exports).fields;

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
left outer join (select id, content as "encData", sha as "encSha", s3_status as "encS3Status" from blobs) as blobs on blobs.id=submission_attachments."blobId"`
    : sql`join (select null as "encKeyId", null as "encData", null as "encSha", null as "encS3Status") as enc on true`}
inner join
  (select "submissionId", (count(id) - 1) as count from submission_defs
    group by "submissionId") as edits
  on edits."submissionId"=submission_defs."submissionId"
${joinOnSkiptoken(options.skiptoken, formId, draft)}
where
  ${encrypted ? sql`(form_defs."encKeyId" is null or ${sqlInArray(sql`form_defs."encKeyId"`, keyIds)}) and` : sql``}
  ${odataFilter(options.filter, options.isSubmissionsTable ? odataToColumnMap : odataSubTableToColumnMap)} and
  ${sqlEquals(options.condition)}
  and submission_defs.current=true and submissions."formId"=${formId} and ${odataExcludeDeleted(options.filter, options.isSubmissionsTable ? odataToColumnMap : odataSubTableToColumnMap)}
${options.orderby ? sql`
  ${odataOrderBy(options.orderby, odataToColumnMap, 'submissions.id')}`
    : sql`order by submissions."createdAt" desc, submissions.id desc`}
${page(options)}`;
};

const streamForExport = (formId, draft, keyIds, options = QueryOptions.none) => ({ s3, stream }) =>
  stream(_export(formId, draft, keyIds, options))
    .then(dbStream => streamEncBlobs(s3, dbStream))
    .then(stream.map(_exportUnjoiner));

const getForExport = (formId, instanceId, draft, options = QueryOptions.none) => ({ maybeOne }) =>
  maybeOne(_export(formId, draft, [], options.withCondition({ 'submissions.instanceId': instanceId })))
    .then(map(_exportUnjoiner));

////////////////////////////////////////////////////////////////////////////////
// DELETE SUBMISSION

const del = (submission) => ({ run }) =>
  run(markDeleted(submission));
del.audit = (submission, form) => (log) => log('submission.delete', { acteeId: form.acteeId }, { submissionId: submission.id, instanceId: submission.instanceId });

const restore = (submission) => ({ run }) =>
  run(markUndeleted(submission));
restore.audit = (submission, form) => (log) => log('submission.restore', { acteeId: form.acteeId }, { submissionId: submission.id, instanceId: submission.instanceId });

////////////////////////////////////////////////////////////////////////////////
// PURGING SOFT-DELETED SUBMISSIONS

// Submission purging and the trash filter can target a specific submission
// or all deleted submissions, but can't be used to filter-purge by project or form.
const _trashedFilter = (force, projectId, xmlFormId, instanceId) => {
  const idFilter = ((instanceId != null) && (projectId != null) && (xmlFormId != null)
    ? sql`and submissions."instanceId" = ${instanceId}
    and forms."projectId" = ${projectId}
    and forms."xmlFormId" = ${xmlFormId}`
    : sql``);
  return (force
    ? sql`submissions."deletedAt" is not null ${idFilter}`
    : sql`submissions."deletedAt" < current_date - cast(${PURGE_DAY_RANGE} as int) ${idFilter}`);
};

const purge = (force = false, projectId = null, xmlFormId = null, instanceId = null) => ({ oneFirst }) => {
  if ((instanceId != null || projectId != null || xmlFormId != null) && !(instanceId != null && projectId != null && xmlFormId != null)) {
    throw Problem.internal.unknown({ error: 'Must specify either all or none of projectId, xmlFormId, and instanceId' });
  }
  return oneFirst(sql`
with redacted_audits as (
    update audits set notes = ''
    from submissions
    join forms on submissions."formId" = forms.id
    where (audits.details->>'submissionId')::int = submissions.id
    and ${_trashedFilter(force, projectId, xmlFormId, instanceId)}
  ), deleted_client_audits as (
    delete from client_audits
    using submission_attachments, submission_defs, submissions, forms
    where client_audits."blobId" = submission_attachments."blobId"
    and submission_attachments."submissionDefId" = submission_defs.id
    and submission_attachments."isClientAudit" = true
    and submission_defs."submissionId" = submissions.id
    and submissions."formId" = forms.id
    and ${_trashedFilter(force, projectId, xmlFormId, instanceId)}
  ), purge_audits as (
    insert into audits ("action", "loggedAt", "processed", "details")
    select 'submission.purge', clock_timestamp(), clock_timestamp(), jsonb_build_object('submissions_deleted', "count")
    from (
      select count(*) as count
      from submissions
      join forms on forms.id = submissions."formId"
      where ${_trashedFilter(force, projectId, xmlFormId, instanceId)}
    ) as del_sub_count
    where del_sub_count.count > 0
  ), deleted_submissions as (
    delete from submissions
    using forms
    where submissions."formId" = forms.id
    and ${_trashedFilter(force, projectId, xmlFormId, instanceId)}
    returning 1
  )
select count(*) from deleted_submissions`);
};

module.exports = {
  createNew, createVersion,
  update, del, restore, purge, clearDraftSubmissionsForProject, deleteDraftSubmissions,
  setSelectMultipleValues, getSelectMultipleValuesForExport,
  getByIdsWithDef, getSubAndDefById,
  getByIds, getAllForFormByIds, getById, countByFormId, verifyVersion,
  getDefById, getCurrentDefByIds, getCurrentDefColByIds, getCurrentDefColsByIds, getAnyDefByFormAndInstanceId, getDefsByFormAndLogicalId, getDefBySubmissionAndInstanceId, getRootForInstanceId, defExists,
  getDeleted,
  streamForExport, getForExport
};

