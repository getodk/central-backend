// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Actor, Entity, Submission, Form } = require('../frames');
const { equals, extender, unjoiner, page, markDeleted } = require('../../util/db');
const { map } = require('ramda');
const { blankStringToNull, construct } = require('../../util/util');
const { QueryOptions } = require('../../util/db');
const { odataFilter } = require('../../data/odata-filter');
const { odataToColumnMap, parseSubmissionXml } = require('../../data/entity');
const { isTrue } = require('../../util/http');
const Problem = require('../../util/problem');
const { runSequentially } = require('../../util/promise');

////////////////////////////////////////////////////////////////////////////////
// ENTITY CREATE

const _defInsert = (id, root, creatorId, userAgent, label, json, version, sourceId = null) => sql`
  insert into entity_defs ("entityId", "root", "sourceId", "creatorId", "userAgent", "label", "data", "current", "createdAt", "version")
  values (${id}, ${root}, ${sourceId}, ${creatorId}, ${userAgent}, ${label}, ${json}, true, clock_timestamp(), ${version})
  returning *`;
const nextval = sql`nextval(pg_get_serial_sequence('entities', 'id'))`;

// Creates both the entity and its initial entity def in one go.
// Note: the logging of this action will happen elsewhere, not with the usual
// createNew.audit mechanism because this is called by a worker rather than a
// standard authenticated API request. The worker has better access to the event
// actor/initiator and actee/target so it will do the logging itself (including
// error logging).
const createNew = (dataset, partial, subDef, sourceId, userAgentIn) => ({ one, context }) => {
  let creatorId;
  let userAgent;
  let subDefId;

  // Set creatorId and userAgent from submission def if it exists
  if (subDef != null && subDef.id != null)
    ({ id: subDefId, submitterId: creatorId, userAgent } = subDef);
  else {
    creatorId = context.auth.actor.map((actor) => actor.id).orNull();
    userAgent = blankStringToNull(userAgentIn);
    subDefId = null;
  }

  const json = JSON.stringify(partial.def.data);

  return one(sql`
with def as (${_defInsert(nextval, true, creatorId, userAgent, partial.def.label, json, 1, sourceId)}),
ins as (insert into entities (id, "datasetId", "uuid", "createdAt", "creatorId")
  select def."entityId", ${dataset.id}, ${partial.uuid}, def."createdAt", ${creatorId} from def
  returning entities.*)
select ins.*, def.id as "entityDefId" from ins, def;`)
    .then(({ entityDefId, ...entityData }) => // TODO/HACK: reassemble just enough to log audit event
      new Entity(entityData, {
        currentVersion: new Entity.Def({
          id: entityDefId,
          entityId: entityData.id,
          submissionDefId: subDefId,
          data: partial.def.data,
          label: partial.def.label
        })
      }));
};


createNew.audit = (newEntity, dataset, partial, subDef) => (log) => {
  if (!subDef)
    return log('entity.create', dataset, {
      entityId: newEntity.id, // Added in v2023.3 and backfilled
      entityDefId: newEntity.aux.currentVersion.id, // Added in v2023.3 and backfilled
      entity: { uuid: newEntity.uuid, dataset: dataset.name }
    });
};
createNew.audit.withResult = true;


// Creates a source entry for entities created through audit events and submissions
const createSource = (details = null, subDefId = null, eventId = null) => ({ one }) => {
  const type = (subDefId) ? 'submission' : 'api';
  return one(sql`insert into entity_def_sources ("type", "submissionDefId", "auditId", "details")
  values (${type}, ${subDefId}, ${eventId}, ${JSON.stringify(details)})
  returning id`)
    .then((row) => row.id);
};


// Entrypoint to where submissions (a specific version) become entities
const _processSubmissionEvent = (event, parentEvent) => async ({ Datasets, Entities, Submissions, Forms, Audits }) => {
  const { submissionId, submissionDefId } = event.details;

  const form = await Forms.getByActeeId(event.acteeId);

  // If form is deleted/purged then submission won't be there either.
  if (!form.isDefined())
    return null;

  const existingEntity = await Entities.getDefBySubmissionId(submissionId);
  // If the submission has already been used to make an entity, don't try again
  // and don't log it as an error.
  if (existingEntity.isDefined())
    return null;

  const submission = await Submissions.getSubAndDefById(submissionDefId);

  // If Submission is deleted/purged - Safety check, will not be true at this line
  if (!submission.isDefined())
    return null;

  // Don't process draft submissions
  if (submission.get().draft)
    return null;

  const submissionDef = submission.get().def;

  const fields = await Datasets.getFieldsByFormDefId(submissionDef.formDefId);
  // No fields found for this formDefId means there is nothing entity-related to parse out
  // of this submission. Even entity system properties like ID and dataset name would be here
  // if the form def is about datasets and entities.
  if (fields.length === 0)
    return null;

  const entityData = await parseSubmissionXml(fields, submissionDef.xml);

  // If dataset requires approval on submission to create an entity and this event is not
  // an approval event, then don't create an entity
  //
  // We can't simply use submissionDefId to trace back to dataset and find out if approval
  // is required because in future there can be multiple entities in a single submission.
  // So we have to rely on dataset name from the xml to fetch the dataset.approvalRequired flag.
  if (!entityData.system.dataset || entityData.system.dataset.trim() === '') {
    throw Problem.user.missingParameter({ field: 'dataset' });
  }

  const dataset = (await Datasets.get(form.get().projectId, entityData.system.dataset, true))
    .orThrow(Problem.user.datasetNotFound({ datasetName: entityData.system.dataset }));

  if ((dataset.approvalRequired && event.details.reviewState !== 'approved') ||
      (!dataset.approvalRequired && event.action === 'submission.update')) // don't process submission if approval is not required and submission metadata is updated
    return null;

  // If create is not true (either 1 or true) then we don't need to process further
  if (!(entityData.system.create === '1' || entityData.system.create === 'true'))
    return null;

  const partial = await Entity.fromParseEntityData(entityData);

  const sourceDetails = { submission: { instanceId: submissionDef.instanceId }, parentEventId: parentEvent ? parentEvent.id : undefined };
  const sourceId = await Entities.createSource(sourceDetails, submissionDefId, event.id);
  const entity = await Entities.createNew(dataset, partial, submissionDef, sourceId);

  return Audits.log({ id: event.actorId }, 'entity.create', { acteeId: dataset.acteeId },
    {
      entityId: entity.id, // Added in v2023.3 and backfilled
      entityDefId: entity.aux.currentVersion.id, // Added in v2023.3 and backfilled
      entity: { uuid: entity.uuid, dataset: dataset.name },
      submissionId,
      submissionDefId
    });
};

const processSubmissionEvent = (event, parentEvent) => (container) =>
  container.db.transaction((trxn) =>
    container.with({ db: trxn }).Entities._processSubmissionEvent(event, parentEvent))
    .catch((err) =>
      // err could be any kind of problem, from an entity violation error, to a
      // database constraint error, to some other kind of error within the processing code.
      // We always surface the error message but only log the error if it is one of our
      // known Problems, just in case there are weird error details we don't want to
      // expose. In experimenting with breaking the code, it seems that non-Problem errors
      // convert to empty objects through the JSON.stringify transformation within audit logging
      // so this probably isn't even an issue.
      // The JSON.stringify appears to strip out error.stack so that doesn't make it to the
      // log details even for our Problems.
      container.Audits.log({ id: event.actorId }, 'entity.create.error', null,
        { submissionId: event.details.submissionId,
          submissionDefId: event.details.submissionDefId,
          errorMessage: err.message,
          problem: (err.isProblem === true) ? err : null }));

const createEntitiesFromPendingSubmissions = (submissionEvents, parentEvent) => (container) =>
  // run sequentially because we want to isolate transaction for each submission
  runSequentially(submissionEvents.map(event =>
    () => processSubmissionEvent(event, parentEvent)(container)));





////////////////////////////////////////////////////////////////////////////////
// UPDATING ENTITIES

const createVersion = (dataset, entity, data, label, version, sourceId, userAgentIn = null) => ({ context, one }) => {
  // dataset is passed in so the audit log can use its actee id
  const creatorId = context.auth.actor.map((actor) => actor.id).orNull();
  const userAgent = blankStringToNull(userAgentIn);
  const json = JSON.stringify(data);

  const _unjoiner = unjoiner(Entity, Entity.Def.into('currentVersion'));

  return one(sql`
  with def as (${_defInsert(entity.id, false, creatorId, userAgent, label, json, version, sourceId)}),
  upd as (update entity_defs set current=false where entity_defs."entityId" = ${entity.id}),
  entities as (update entities set "updatedAt"=clock_timestamp()
    where "uuid"=${entity.uuid}
    returning *)
  select ${_unjoiner.fields} from def as entity_defs
  join entities on entity_defs."entityId" = entities.id
  `)
    .then(_unjoiner);
};

createVersion.audit = (newEntity, dataset, entity) => (log) =>
  log('entity.update.version', dataset, {
    entityId: entity.id,
    entityDefId: newEntity.aux.currentVersion.id,
    entity: { uuid: newEntity.uuid, dataset: dataset.name }
  });
createVersion.audit.withResult = true;

////////////////////////////////////////////////////////////////////////////////
// GETTING ENTITIES

// There is plumbing here for including the entity source submission, but it
// is not currently in use. Leaving it in place for when we do want to include
// source information again.
const _get = (includeSource) => {
  const frames = [Entity];
  if (includeSource) {
    frames.push(Entity.Def.into('currentVersion'), Submission, Submission.Def.into('submissionDef'), Form);
  } else {
    frames.push(Entity.Def.Metadata.into('currentVersion'));
  }
  return extender(...frames)(Actor.into('creator'), Actor.alias('current_version_actors', 'currentVersionCreator'))((fields, extend, options, deleted = false) =>
    sql`
  SELECT ${fields} FROM entities
  INNER JOIN entity_defs
      ON entities.id = entity_defs."entityId" AND entity_defs.current
  ${extend||sql`
    LEFT JOIN actors ON actors.id=entities."creatorId"
    LEFT JOIN actors current_version_actors ON current_version_actors.id=entity_defs."creatorId"
  `}
  ${!includeSource ? sql`` : sql`
    LEFT JOIN entity_def_sources ON entity_defs."sourceId" = entity_def_sources."id"
    LEFT JOIN submission_defs ON submission_defs.id = entity_def_sources."submissionDefId"
    LEFT JOIN (
      SELECT submissions.*, submission_defs."userAgent" FROM submissions
      JOIN submission_defs ON submissions.id = submission_defs."submissionId" AND root
    ) submissions ON submissions.id = submission_defs."submissionId"
    LEFT JOIN forms ON submissions."formId" = forms.id
  `} 
  where ${equals(options.condition)} and entities."deletedAt" is ${deleted ? sql`not` : sql``} null
  order by entity_defs.id, entities."createdAt" desc, entities.id desc
`);
};

const assignCurrentVersionCreator = (entity) => {
  const currentVersion = new Entity.Def(entity.aux.currentVersion, { creator: entity.aux.currentVersionCreator });
  return new Entity(entity, { currentVersion, creator: entity.aux.creator });
};

const getById = (datasetId, uuid, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(true)(maybeOne, options.withCondition({ datasetId, uuid }), isTrue(options.argData?.deleted))
    .then(map(assignCurrentVersionCreator));

const getAll = (datasetId, options = QueryOptions.none) => ({ all }) =>
  _get(false)(all, options.withCondition({ datasetId }), isTrue(options.argData.deleted))
    .then(map(assignCurrentVersionCreator));

////////////////////////////////////////////////////////////////////////////////
// GETTING ENTITY DEFS

const _getDef = extender(Entity.Def)(Actor.into('creator'))((fields, extend, options) => sql`
  SELECT ${fields} FROM entities
  JOIN entity_defs ON entities.id = entity_defs."entityId"
  ${extend||sql`
    LEFT JOIN actors ON actors.id=entity_defs."creatorId"
  `}
  where ${equals(options.condition)} AND entities."deletedAt" IS NULL
  order by entity_defs."createdAt", entity_defs.id
`);

const getAllDefs = (datasetId, uuid, options = QueryOptions.none) => ({ all }) =>
  _getDef(all, options.withCondition({ datasetId, uuid }))
    .then(map((v) => new Entity.Def(v, { creator: v.aux.creator })));

// This will check for an entity related to any def of the same submission
// as the one specified. Used when trying to reapprove an edited submission.
const getDefBySubmissionId = (submissionId) => ({ maybeOne }) =>
  maybeOne(sql`SELECT ed.* FROM submissions AS s
  JOIN submission_defs AS sd ON s."id" = sd."submissionId"
  JOIN entity_def_sources AS eds ON eds."submissionDefId" = sd."id"
  JOIN entity_defs as ed on ed."sourceId" = eds."id"
  WHERE s.id = ${submissionId} limit 1`)
    .then(map(construct(Entity.Def)));



////////////////////////////////////////////////////////////////////////////////
// SERVING ENTITIES

const _exportUnjoiner = unjoiner(Entity, Entity.Def, Entity.Extended.into('stats'), Actor.alias('actors', 'creator'));

const streamForExport = (datasetId, options = QueryOptions.none) => ({ stream }) =>
  stream(sql`
SELECT ${_exportUnjoiner.fields} FROM entity_defs
INNER JOIN entities ON entities.id = entity_defs."entityId"
INNER JOIN
  (
    SELECT "entityId", (COUNT(id) - 1) AS "updates" FROM entity_defs GROUP BY "entityId"
  ) stats ON stats."entityId"=entity_defs."entityId"
LEFT JOIN actors ON entities."creatorId"=actors.id
${options.skiptoken ? sql`
  INNER JOIN
  ( SELECT id, "createdAt" FROM entities WHERE "uuid" = ${options.skiptoken.uuid}) AS cursor
  ON entities."createdAt" <= cursor."createdAt" AND entities.id < cursor.id
  `: sql``} 
WHERE
  entities."datasetId" = ${datasetId}
  AND entities."deletedAt" IS NULL
  AND entity_defs.current=true
  AND  ${odataFilter(options.filter, odataToColumnMap)}
ORDER BY entities."createdAt" DESC, entities.id DESC
${page(options)}`)
    .then(stream.map(_exportUnjoiner));

const countByDatasetId = (datasetId, options = QueryOptions.none) => ({ one }) => one(sql`
SELECT * FROM

(
  SELECT count(*) count FROM entities
  WHERE "datasetId" = ${datasetId}
  AND "deletedAt" IS NULL
  AND  ${odataFilter(options.filter, odataToColumnMap)}
) AS "all"
  
CROSS JOIN 
(
  SELECT COUNT(*) remaining FROM entities
  ${options.skiptoken ? sql`
  INNER JOIN
  ( SELECT id, "createdAt" FROM entities WHERE "uuid" = ${options.skiptoken.uuid}) AS cursor
  ON entities."createdAt" <= cursor."createdAt" AND entities.id < cursor.id
  `: sql``} 
  WHERE "datasetId" = ${datasetId}
  AND "deletedAt" IS NULL
  AND  ${odataFilter(options.filter, odataToColumnMap)}
) AS skiptoken`);


////////////////////////////////////////////////////////////////////////////////
// DELETE ENTITY

const del = (entity) => ({ run }) =>
  run(markDeleted(entity));

del.audit = (entity, dataset) => (log) => log('entity.delete', entity.with({ acteeId: dataset.acteeId }), { uuid: entity.uuid });

module.exports = {
  createNew, _processSubmissionEvent,
  createSource,
  processSubmissionEvent, streamForExport,
  getDefBySubmissionId,
  createVersion,
  countByDatasetId, getById,
  getAll, getAllDefs, del,
  createEntitiesFromPendingSubmissions
};
