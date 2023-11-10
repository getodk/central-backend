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
const { map, mergeRight, pickAll } = require('ramda');
const { blankStringToNull, construct } = require('../../util/util');
const { QueryOptions } = require('../../util/db');
const { odataFilter } = require('../../data/odata-filter');
const { odataToColumnMap, parseSubmissionXml, getDiffProp, ConflictType } = require('../../data/entity');
const { isTrue } = require('../../util/http');
const Problem = require('../../util/problem');
const { runSequentially } = require('../../util/promise');


/////////////////////////////////////////////////////////////////////////////////
// ENTITY DEF SOURCES

const createSource = (details = null, subDefId = null, eventId = null) => ({ one }) => {
  const type = (subDefId) ? 'submission' : 'api';
  return one(sql`insert into entity_def_sources ("type", "submissionDefId", "auditId", "details")
  values (${type}, ${subDefId}, ${eventId}, ${JSON.stringify(details)})
  returning id`)
    .then((row) => row.id);
};

////////////////////////////////////////////////////////////////////////////////
// ENTITY CREATE

const _defInsert = (id, root, creatorId, userAgent, label, json, version, dataReceived, sourceId = null, baseVersion = null, conflictingProperties = null) => sql`
  insert into entity_defs ("entityId", "root", "sourceId", "creatorId", "userAgent", "label", "data", "current", "createdAt", "version", "baseVersion", "dataReceived", "conflictingProperties")
  values (${id}, ${root}, ${sourceId}, ${creatorId}, ${userAgent}, ${label}, ${json}, true, clock_timestamp(), ${version}, ${baseVersion}, ${dataReceived}, ${conflictingProperties})
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

  // Set creatorId and userAgent from submission def if it exists
  if (subDef != null) {
    ({ submitterId: creatorId, userAgent } = subDef);
  } else {
    creatorId = context.auth.actor.map((actor) => actor.id).orNull();
    userAgent = blankStringToNull(userAgentIn);
  }

  const json = JSON.stringify(partial.def.data);

  return one(sql`
with def as (${_defInsert(nextval, true, creatorId, userAgent, partial.def.label, json, 1, json, sourceId)}),
ins as (insert into entities (id, "datasetId", "uuid", "createdAt", "creatorId")
  select def."entityId", ${dataset.id}, ${partial.uuid}, def."createdAt", ${creatorId} from def
  returning entities.*)
select ins.*, def.id as "entityDefId" from ins, def;`)
    .then(({ entityDefId, ...entityData }) => // TODO/HACK: reassemble just enough to log audit event
      new Entity(entityData, {
        currentVersion: new Entity.Def({
          id: entityDefId,
          entityId: entityData.id
        })
      }));
};

createNew.audit = (newEntity, dataset, partial, subDef) => (log) => {
  if (!subDef) // entities created from submissions are logged elsewhere
    return log('entity.create', dataset, {
      entityId: newEntity.id, // Added in v2023.3 and backfilled
      entityDefId: newEntity.aux.currentVersion.id, // Added in v2023.3 and backfilled
      entity: { uuid: newEntity.uuid, dataset: dataset.name }
    });
};
createNew.audit.withResult = true;


////////////////////////////////////////////////////////////////////////////////
// ENTITY UPDATE

const createVersion = (dataset, partial, subDef, version, sourceId, baseVersion, userAgentIn = null) => ({ context, one }) => {
  let creatorId;
  let userAgent;

  // Set creatorId and userAgent from submission def if it exists
  if (subDef != null) {
    ({ submitterId: creatorId, userAgent } = subDef);
  } else {
    creatorId = context.auth.actor.map((actor) => actor.id).orNull();
    userAgent = blankStringToNull(userAgentIn);
  }

  const json = JSON.stringify(partial.def.data);

  const dataReceived = JSON.stringify(partial.def.dataReceived);

  const conflictingPropJson = partial.def.conflictingProperties ? JSON.stringify(partial.def.conflictingProperties) : null;

  const _unjoiner = unjoiner(Entity, Entity.Def.into('currentVersion'));

  return one(sql`
  with def as (${_defInsert(partial.id, false, creatorId, userAgent, partial.def.label, json, version, dataReceived, sourceId, baseVersion, conflictingPropJson)}),
  upd as (update entity_defs set current=false where entity_defs."entityId" = ${partial.id}),
  entities as (update entities set "updatedAt"=clock_timestamp(), conflict=${partial.conflict ?? sql`NULL`}
    where "uuid"=${partial.uuid}
    returning *)
  select ${_unjoiner.fields} from def as entity_defs
  join entities on entity_defs."entityId" = entities.id
  `)
    .then(_unjoiner);
};

createVersion.audit = (updatedEntity, dataset, partial, subDef) => (log) => {
  if (!subDef) // entities updated from submissions are logged elsewhere
    return log('entity.update.version', dataset, {
      entityId: updatedEntity.id,
      entityDefId: updatedEntity.aux.currentVersion.id,
      entity: { uuid: updatedEntity.uuid, dataset: dataset.name }
    });
};
createVersion.audit.withResult = true;

////////////////////////////////////////////////////////////////////////////////
// RESOLVE CONFLICT

const resolveConflict = (entity, dataset) => ({ one }) => // eslint-disable-line no-unused-vars
  one(sql`UPDATE entities SET conflict=NULL, "updatedAt"=CLOCK_TIMESTAMP() WHERE "id"=${entity.id} RETURNING *`)
    .then(r => entity.with({ conflict: r.conflict, updatedAt: r.updatedAt }));

resolveConflict.audit = (entity, dataset) => (log) => log('entity.update.resolve', dataset, {
  entityId: entity.id,
  entityDefId: entity.aux.currentVersion.id,
  entity: { uuid: entity.uuid, dataset: dataset.name }
});

/////////////////////////////////////////////////////////////////////////
// Processing submission events to create and update entities

const _createEntity = (dataset, entityData, submissionId, submissionDef, submissionDefId, event, parentEvent) => async ({ Audits, Entities }) => {
  // If dataset requires approval on submission to create an entity and this event is not
  // an approval event, then don't create an entity
  if ((dataset.approvalRequired && event.details.reviewState !== 'approved') ||
      (!dataset.approvalRequired && event.action === 'submission.update')) // don't process submission if approval is not required and submission metadata is updated
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

const _updateEntity = (dataset, entityData, submissionId, submissionDef, submissionDefId, event) => async ({ Audits, Entities, maybeOne }) => {
  if (!(event.action === 'submission.create')) // only update on submission.create
    return null;

  // Get client version of entity
  const clientEntity = await Entity.fromParseEntityData(entityData); // validation happens here

  // Get version of entity on the server
  const serverEntity = (await Entities.getById(dataset.id, clientEntity.uuid, QueryOptions.forUpdate))
    .orThrow(Problem.user.entityNotFound({ entityUuid: clientEntity.uuid, datasetName: dataset.name }));

  let { conflict } = serverEntity;
  let conflictingProperties; // Maybe we don't need to persist this??? just compute at the read time

  if (clientEntity.def.baseVersion !== serverEntity.aux.currentVersion.version) {

    const condition = { datasetId: dataset.id, uuid: clientEntity.uuid, version: clientEntity.def.baseVersion };
    // eslint-disable-next-line no-use-before-define
    const baseEntityVersion = (await _getDef(maybeOne, new QueryOptions({ condition })))
      .orThrow(Problem.user.entityVersionNotFound({ baseVersion: clientEntity.def.baseVersion, entityUuid: clientEntity.uuid, datasetName: dataset.name }));

    // we need to find what changed between baseVersion and lastVersion
    // it is not the data we received in lastVersion
    const serverVersionDiff = getDiffProp(serverEntity.aux.currentVersion.data, baseEntityVersion.data);
    const serverDiffData = pickAll(serverVersionDiff, serverEntity.aux.currentVersion.data);
    if (serverEntity.aux.currentVersion.label !== baseEntityVersion.label)
      serverDiffData.label = serverEntity.aux.currentVersion.label;

    conflictingProperties = Object.keys(clientEntity.def.dataReceived).filter(key => key in serverDiffData && clientEntity.def.dataReceived[key] !== serverDiffData[key]);

    if (conflict !== ConflictType.HARD) { // We don't want to downgrade conflict here
      conflict = conflictingProperties.length > 0 ? ConflictType.HARD : ConflictType.SOFT;
    }
  }

  // merge data
  const mergedData = mergeRight(serverEntity.aux.currentVersion.data, clientEntity.def.data);
  const mergedLabel = clientEntity.def.label ?? serverEntity.aux.currentVersion.label;

  // make some kind of source object
  const sourceDetails = {
    submission: { instanceId: submissionDef.instanceId }
  };
  const sourceId = await Entities.createSource(sourceDetails, submissionDefId, event.id);
  const partial = new Entity.Partial(serverEntity.with({ conflict }), {
    def: new Entity.Def({
      data: mergedData,
      label: mergedLabel,
      dataReceived: clientEntity.def.dataReceived,
      conflictingProperties
    })
  });

  const entity = await Entities.createVersion(dataset, partial, submissionDef, serverEntity.aux.currentVersion.version + 1, sourceId, clientEntity.def.baseVersion);
  return Audits.log({ id: event.actorId }, 'entity.update.version', { acteeId: dataset.acteeId },
    {
      entityId: entity.id,
      entityDefId: entity.aux.currentVersion.id,
      entity: { uuid: entity.uuid, dataset: dataset.name },
      submissionId,
      submissionDefId
    });
};

// Entrypoint to where submissions (a specific version) become entities
const _processSubmissionEvent = (event, parentEvent) => async ({ Datasets, Entities, Submissions, Forms }) => {
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

  // We have to look up the dataset based on the name in the XML
  if (!entityData.system.dataset || entityData.system.dataset.trim() === '') {
    throw Problem.user.missingParameter({ field: 'dataset' });
  }
  const dataset = (await Datasets.get(form.get().projectId, entityData.system.dataset, true))
    .orThrow(Problem.user.datasetNotFound({ datasetName: entityData.system.dataset }));

  // Or update entity
  if (entityData.system.update === '1' || entityData.system.update === 'true')
    try {
      await Entities._updateEntity(dataset, entityData, submissionId, submissionDef, submissionDefId, event);
    } catch (err) {
      if ((err.problemCode === 404.8) && (entityData.system.create === '1' || entityData.system.create === 'true')) {
        await Entities._createEntity(dataset, entityData, submissionId, submissionDef, submissionDefId, event, parentEvent);
      } else {
        throw (err);
      }
    }
  else if (entityData.system.create === '1' || entityData.system.create === 'true')
    return Entities._createEntity(dataset, entityData, submissionId, submissionDef, submissionDefId, event, parentEvent);

  return null;
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
      container.Audits.log({ id: event.actorId }, 'entity.error', null,
        { submissionId: event.details.submissionId,
          submissionDefId: event.details.submissionDefId,
          errorMessage: err.message,
          problem: (err.isProblem === true) ? err : null }));

const createEntitiesFromPendingSubmissions = (submissionEvents, parentEvent) => (container) =>
  // run sequentially because we want to isolate transaction for each submission
  runSequentially(submissionEvents.map(event =>
    () => processSubmissionEvent(event, parentEvent)(container)));



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

// This is Postgresql Advisory Lock
// We can't use `FOR UPDATE` clause because of "Read Committed Isolation Level",
// i.e. blocked transaction gets the row version that was at the start of the command,
// (after lock is released by the first transaction), even if transaction with lock has updated that row.
const _lockEntity = (exec, uuid) => exec(sql`SELECT pg_advisory_xact_lock(id) FROM entities WHERE uuid = ${uuid};`);

const assignCurrentVersionCreator = (entity) => {
  const currentVersion = new Entity.Def(entity.aux.currentVersion, { creator: entity.aux.currentVersionCreator });
  return new Entity(entity, { currentVersion, creator: entity.aux.creator });
};

const getById = (datasetId, uuid, options = QueryOptions.none) => async ({ maybeOne }) => {
  if (options.forUpdate) {
    await _lockEntity(maybeOne, uuid);
  }
  return _get(true)(maybeOne, options.withCondition({ datasetId, uuid }), isTrue(options.argData?.deleted))
    .then(map(assignCurrentVersionCreator));
};

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
  _createEntity, _updateEntity,
  processSubmissionEvent, streamForExport,
  getDefBySubmissionId,
  createVersion,
  countByDatasetId, getById,
  getAll, getAllDefs, del,
  createEntitiesFromPendingSubmissions,
  resolveConflict
};
