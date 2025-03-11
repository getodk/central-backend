// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const config = require('config');
const { sql } = require('slonik');
const { Actor, Audit, Entity, Submission, Form } = require('../frames');
const { sqlEquals, extender, unjoiner, page, markDeleted, insertMany, markUndeleted } = require('../../util/db');
const { map, mergeRight, pickAll, pipe, reduceBy, toPairs } = require('ramda');
const { blankStringToNull, construct } = require('../../util/util');
const { QueryOptions } = require('../../util/db');
const { odataFilter, odataOrderBy, odataExcludeDeleted } = require('../../data/odata-filter');
const { odataToColumnMap, parseSubmissionXml, getDiffProp, ConflictType, normalizeUuid } = require('../../data/entity');
const { isTrue } = require('../../util/http');
const Problem = require('../../util/problem');
const { getOrReject, runSequentially } = require('../../util/promise');
const { PURGE_DAY_RANGE } = require('../../util/constants');

/////////////////////////////////////////////////////////////////////////////////
// Check if provided UUIDs (array) were used by purged entities.

const _getPurgedOrDeletedUuids = (all, uuids) => all(sql`
    SELECT jsonb_array_elements_text(details -> 'entityUuids') AS uuid FROM audits a WHERE action = 'entity.purge'
    INTERSECT
    SELECT jsonb_array_elements_text(${JSON.stringify(uuids)})
    UNION
    SELECT uuid FROM entities WHERE "deletedAt" IS NOT NULL AND uuid = ANY (ARRAY[${sql.array(uuids, 'text')}])`)
  .then(all.map(r => r.uuid));

const _isPurgedOrDeletedUuid = (oneFirst, uuid) => oneFirst(sql`
    SELECT
      EXISTS ( SELECT 1 FROM audits WHERE action = 'entity.purge' AND details -> 'entityUuids' @> ${JSON.stringify([uuid])} )
      OR
      EXISTS ( SELECT 1 FROM entities WHERE uuid = ${uuid} AND "deletedAt" IS NOT NULL )
  `);
/////////////////////////////////////////////////////////////////////////////////
// ENTITY DEF SOURCES

const createSource = (details = null, subDefId = null, eventId = null, forceProcessed = false) => ({ one }) => {
  const type = (subDefId) ? 'submission' : 'api';
  return one(sql`insert into entity_def_sources ("type", "submissionDefId", "auditId", "details", "forceProcessed")
  values (${type}, ${subDefId}, ${eventId}, ${JSON.stringify(details)}, ${forceProcessed})
  returning id`)
    .then((row) => row.id);
};

////////////////////////////////////////////////////////////////////////////////
// ENTITY CREATE

const _defInsert = (id, root, creatorId, userAgent, partial, version, sourceId = null, baseVersion = null, conflictingProperties = null) => {
  const json = JSON.stringify(partial.def.data);
  const dataReceived = JSON.stringify(partial.def.dataReceived);

  return sql`
  insert into entity_defs ("entityId", "createdAt",
    "root", "current",
    "sourceId", "creatorId", "userAgent",
    "label", "data", "dataReceived",
    "version", "baseVersion",
    "trunkVersion", "branchId", "branchBaseVersion",
    "conflictingProperties")
  values (${id}, clock_timestamp(),
    ${root}, true,
    ${sourceId}, ${creatorId}, ${userAgent},
    ${partial.def.label}, ${json}, ${dataReceived},
    ${version}, ${baseVersion},
    ${partial.def.trunkVersion ?? null}, ${partial.def.branchId ?? null}, ${partial.def.branchBaseVersion ?? null},
    ${conflictingProperties})
  returning *`;
};

const nextval = sql`nextval(pg_get_serial_sequence('entities', 'id'))`;

// Creates both the entity and its initial entity def in one go.
// Note: the logging of this action will happen elsewhere, not with the usual
// createNew.audit mechanism because this is called by a worker rather than a
// standard authenticated API request. The worker has better access to the event
// actor/initiator and actee/target so it will do the logging itself (including
// error logging).
const createNew = (dataset, partial, subDef, sourceId, userAgentIn) => async ({ one, context, oneFirst }) => {
  let creatorId;
  let userAgent;

  // Validate UUID against purged entities
  if (await _isPurgedOrDeletedUuid(oneFirst, partial.uuid)) {
    throw Problem.user.entityUniquenessViolationWithDeleted({ entityUuids: [partial.uuid] });
  }

  // Set creatorId and userAgent from submission def if it exists
  if (subDef != null) {
    ({ submitterId: creatorId, userAgent } = subDef);
  } else {
    creatorId = context.auth.actor.map((actor) => actor.id).orNull();
    userAgent = blankStringToNull(userAgentIn);
  }

  return one(sql`
with def as (${_defInsert(nextval, true, creatorId, userAgent, partial, 1, sourceId)}),
ins as (insert into entities (id, "datasetId", "uuid", "createdAt", "creatorId")
  select def."entityId", ${dataset.id}, ${partial.uuid}, def."createdAt", ${creatorId} from def
  returning entities.*)
select ins.*, def.id as "entityDefId" from ins, def;`)
    .then(({ entityDefId, ...entityData }) => // TODO/HACK: starting to need more reassembling
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
  return Promise.resolve();
};
createNew.audit.withResult = true;

// createMany() inserts many entities and entity defs in bulk two main queries.
// it could be used in places of createNew() but createNew uses a single query so it may be faster
// in single entity situations (eg. processing submissions to make entities)
// Note: if the entity schema changes, createMany and createNew would both need to change.
const createMany = (dataset, rawEntities, sourceId, userAgentIn) => async ({ all, context }) => {
  const creatorId = context.auth.actor.map((actor) => actor.id).orNull();
  const userAgent = blankStringToNull(userAgentIn);

  // Validate UUID with the purged entities
  const purgedUuids = await _getPurgedOrDeletedUuids(all, rawEntities.map(e => e.uuid));
  if (purgedUuids.length > 0) {
    throw Problem.user.entityUniquenessViolationWithDeleted({ entityUuids: purgedUuids });
  }

  // Augment parsed entity data with dataset and creator IDs
  const entitiesForInsert = rawEntities.map(e => new Entity({ datasetId: dataset.id, creatorId, ...e }));
  const entities = await all(sql`${insertMany(entitiesForInsert)} RETURNING id`);

  // Augment defs with IDs of freshly inserted entities and
  // other default values
  const defsForInsert = rawEntities.map((e, i) => new Entity.Def({
    entityId: entities[i].id,
    creatorId,
    root: true,
    current: true,
    sourceId,
    version: 1,
    userAgent,
    ...e.def
  }));
  return all(insertMany(defsForInsert));
};

createMany.audit = (dataset, entities, sourceId) => (log) =>
  log('entity.bulk.create', dataset, { sourceId });
createMany.audit.withResult = false;


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

  const conflictingPropJson = partial.def.conflictingProperties ? JSON.stringify(partial.def.conflictingProperties) : null;

  const _unjoiner = unjoiner(Entity, Entity.Def.into('currentVersion'));

  return one(sql`
  with def as (${_defInsert(partial.id, false, creatorId, userAgent, partial, version, sourceId, baseVersion, conflictingPropJson)}),
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
  return Promise.resolve();
};
createVersion.audit.withResult = true;


////////////////////////////////////////////////////////////////////////////////
// LOCKING ENTITIES

/*
_lockEntity() locks the specified entity until the end of the transaction. If
another transaction tries to lock the same entity, it will have to wait until
this lock is released (at the end of this transaction). Locking an entity does
not affect queries that do not lock entities. For example, exporting entities is
not affected.

If a request or some other process creates or updates an entity, and some other
process might attempt to concurrently create or update the same entity, then the
first process should lock the entity. It should lock the entity even before
reading the entity, not just before changing it. Note that a process can lock an
entity before it exists; this is needed for offline updates (see
_processSubmissionEvent()).

_lockEntity() uses a Postgres advisory lock.
We can't use `FOR UPDATE` clause because of "Read Committed Isolation Level",
i.e. blocked transaction gets the row version that was at the start of the command,
(after lock is released by the first transaction), even if transaction with lock has updated that row.
*/
const _lockEntity = (exec, uuid) => {
  // pg_advisory_xact_lock() takes a bigint. A 16-digit hex number could exceed
  // the bigint max, so we only use the first 15 digits of the UUID.
  const lockId = Number.parseInt(uuid.replaceAll('-', '').slice(0, 15), 16);
  return exec(sql`SELECT pg_advisory_xact_lock(${lockId})`);
};


////////////////////////////////////////////////////////////////////////////////
// WRAPPER FUNCTIONS FOR CREATING AND UPDATING ENTITIES

const _createEntity = (dataset, entityData, submissionId, submissionDef, submissionDefId, event, parentEvent, forceOutOfOrderProcessing) => async ({ Audits, Entities }) => {
  // If dataset requires approval on submission to create an entity and this event is not
  // an approval event, then don't create an entity
  if ((dataset.approvalRequired && event.details.reviewState !== 'approved') ||
      (!dataset.approvalRequired && event.action === 'submission.update')) // don't process submission if approval is not required and submission metadata is updated
    return null;

  // Auto-generate a label if forced and if the submission doesn't provide one
  if (forceOutOfOrderProcessing && (entityData.system.label == null || entityData.system.label.trim() === '')) {
    // eslint-disable-next-line no-param-reassign
    entityData.system.label = 'auto generated';
  }

  // Add the branchBaseVersion to the partial if we are forcing the create and it has one
  const _partial = await Entity.fromParseEntityData(entityData, { create: true });
  const partial = (forceOutOfOrderProcessing)
    ? _partial.auxWith('def', { branchBaseVersion: _partial.def.baseVersion })
    : _partial;

  // Because of entity processing flow, we need to check for a conflict explicitly without
  // disrupting the database transaction.
  const maybeEntity = await Entities.getById(dataset.id, partial.uuid);
  if (maybeEntity.isDefined())
    throw Problem.user.uniquenessViolation({ fields: ['uuid'], values: [partial.uuid] });

  const sourceDetails = { submission: { instanceId: submissionDef.instanceId }, parentEventId: parentEvent ? parentEvent.id : undefined };
  const sourceId = await Entities.createSource(sourceDetails, submissionDefId, event.id, forceOutOfOrderProcessing);
  const entity = await Entities.createNew(dataset, partial, submissionDef, sourceId);

  await Audits.log({ id: event.actorId }, 'entity.create', { acteeId: dataset.acteeId },
    {
      entityId: entity.id, // Added in v2023.3 and backfilled
      entityDefId: entity.aux.currentVersion.id, // Added in v2023.3 and backfilled
      entity: { uuid: entity.uuid, dataset: dataset.name },
      submissionId,
      submissionDefId
    });
  return entity;
};

// Extra flags
// - forceOutOfOrderProcessing: entity was in backlog and was force-processed, which affects base version calculation
// - createSubAsUpdate: submission was meant to *create* entity (and should be parsed as such) but is applied as an update
const _updateEntity = (dataset, entityData, submissionId, submissionDef, submissionDefId, event, forceOutOfOrderProcessing, createSubAsUpdate = false) => async ({ Audits, Entities }) => {
  if (!(event.action === 'submission.create'
    || event.action === 'submission.update.version'
    || event.action === 'submission.backlog.reprocess'))
    return null;

  // Get client version of entity
  const clientEntity = await Entity.fromParseEntityData(entityData, createSubAsUpdate ? { create: true } : { update: true }); // validation happens here

  // Figure out the intended baseVersion
  // If this is an offline update with a branchId, the baseVersion value is local to that offline context.
  let baseEntityDef;

  // Try computing base version.
  // But if there is a 404.8 not found error, double-check if the entity never existed or was deleted.
  try {
    baseEntityDef = await Entities._computeBaseVersion(event, dataset, clientEntity, submissionDef, forceOutOfOrderProcessing, createSubAsUpdate);
  } catch (err) {
    if (err.problemCode === 404.8) {
      // Look up deleted entity by passing deleted as option argData
      const deletedEntity = await Entities.getById(dataset.id, clientEntity.uuid, new QueryOptions({ argData: { deleted: 'true' } }));
      if (deletedEntity.isDefined())
        throw Problem.user.entityDeleted({ entityUuid: clientEntity.uuid });
    }
    throw err;
  }

  // If baseEntityVersion is null, we held a submission and will stop processing now.
  if (baseEntityDef == null)
    return null;

  // Get version of entity on the server
  let serverEntity = await Entities.getById(dataset.id, clientEntity.uuid, QueryOptions.forUpdate);
  if (serverEntity.isEmpty()) {
    // We probably never get into this case because computeBaseVersion also checks for the existence of the entity
    // and returns an entity def associated with a top level entity.
    throw Problem.user.entityNotFound({ entityUuid: clientEntity.uuid, datasetName: dataset.name });
  } else {
    serverEntity = serverEntity.get();
  }

  // If the trunk version exists but is higher than current server version,
  // that is a weird case that should not be processed OR held, and should log an error.
  if (clientEntity.def.trunkVersion && clientEntity.def.trunkVersion > serverEntity.aux.currentVersion.version) {
    throw Problem.user.entityVersionNotFound({ baseVersion: `trunkVersion=${clientEntity.def.trunkVersion}`, entityUuid: clientEntity.uuid, datasetName: dataset.name });
  }

  let { conflict } = serverEntity;
  let conflictingProperties; // Maybe we don't need to persist this??? just compute at the read time

  if (baseEntityDef.version !== serverEntity.aux.currentVersion.version) {
    // we need to find what changed between baseVersion and lastVersion
    // it is not the data we received in lastVersion
    const serverVersionDiff = getDiffProp(serverEntity.aux.currentVersion.data, baseEntityDef.data);
    const serverDiffData = pickAll(serverVersionDiff, serverEntity.aux.currentVersion.data);
    if (serverEntity.aux.currentVersion.label !== baseEntityDef.label)
      serverDiffData.label = serverEntity.aux.currentVersion.label;

    conflictingProperties = Object.keys(clientEntity.def.dataReceived).filter(key => key in serverDiffData && clientEntity.def.dataReceived[key] !== serverDiffData[key]);
    if (conflict !== ConflictType.HARD) { // We don't want to downgrade conflict here
      conflict = conflictingProperties.length > 0 ? ConflictType.HARD : ConflictType.SOFT;
    }
  } else if (createSubAsUpdate) {
    const versionDiff = getDiffProp(serverEntity.aux.currentVersion.data, clientEntity.def.dataReceived);
    const diffData = pickAll(versionDiff, serverEntity.aux.currentVersion.data);

    if (serverEntity.aux.currentVersion.label !== clientEntity.def.label)
      diffData.label = serverEntity.aux.currentVersion.label;

    conflictingProperties = Object.keys(clientEntity.def.dataReceived).filter(key => key in diffData && clientEntity.def.dataReceived[key] !== diffData[key]);

    if (conflict !== ConflictType.HARD) { // We don't want to downgrade conflict here
      conflict = conflictingProperties.length > 0 ? ConflictType.HARD : ConflictType.SOFT;
    }
  } else {
    // This may still be a soft conflict if the new version is not contiguous with this branch's trunk version
    const interrupted = await Entities._interruptedBranch(serverEntity.id, clientEntity);
    if (interrupted && conflict !== ConflictType.HARD) {
      conflict = ConflictType.SOFT;
    }
  }

  // merge data
  const mergedData = mergeRight(serverEntity.aux.currentVersion.data, clientEntity.def.data);
  const mergedLabel = clientEntity.def.label ?? serverEntity.aux.currentVersion.label;

  // make some kind of source object
  const sourceDetails = {
    submission: {
      instanceId: submissionDef.instanceId,
    },
    ...createSubAsUpdate ? { action: 'create' } : {}
  };
  const sourceId = await Entities.createSource(sourceDetails, submissionDefId, event.id, forceOutOfOrderProcessing);
  const partial = new Entity.Partial(serverEntity.with({ conflict }), {
    def: new Entity.Def({
      data: mergedData,
      label: mergedLabel,
      dataReceived: clientEntity.def.dataReceived,
      branchId: clientEntity.def.branchId,
      trunkVersion: clientEntity.def.trunkVersion,
      branchBaseVersion: (clientEntity.def.branchId != null) ? clientEntity.def.baseVersion : null,
      conflictingProperties
    })
  });

  // Assign new version (increment latest server version)
  const version = serverEntity.aux.currentVersion.version + 1;

  const entity = await Entities.createVersion(dataset, partial, submissionDef, version, sourceId, baseEntityDef.version);
  await Audits.log({ id: event.actorId }, 'entity.update.version', { acteeId: dataset.acteeId },
    {
      entityId: entity.id,
      entityDefId: entity.aux.currentVersion.id,
      entity: { uuid: entity.uuid, dataset: dataset.name },
      submissionId,
      submissionDefId
    });
  return entity;
};

////////////////////////////////////////////////////////////////////////////////
// Create/update helper functions

// Used by _updateVerison to figure out the intended base version in Central
// based on the branchId, trunkVersion, and baseVersion in the submission
const _computeBaseVersion = (event, dataset, clientEntity, submissionDef, forceOutOfOrderProcessing, createSubAsUpdate) => async ({ Entities }) => {
  if (createSubAsUpdate) {
    // We are in the special case of force-apply create-as-update. get the latest version.
    const latestEntity = await Entities.getById(dataset.id, clientEntity.uuid)
      .then(getOrReject(Problem.user.entityNotFound({ entityUuid: clientEntity.uuid, datasetName: dataset.name })));
    return latestEntity.aux.currentVersion;

  } else if (!clientEntity.def.branchId) {

    // no offline branching to deal with, use baseVersion as is
    const condition = { version: clientEntity.def.baseVersion };
    const maybeDef = await Entities.getDef(dataset.id, clientEntity.uuid, new QueryOptions({ condition }));

    if (maybeDef.isEmpty()) {
      // If the def doesn't exist, check if the version doesnt exist or the whole entity doesnt exist
      // There are different problems for each case
      const maybeEntity = await Entities.getById(dataset.id, clientEntity.uuid);
      if (maybeEntity.isDefined())
        throw Problem.user.entityVersionNotFound({ baseVersion: clientEntity.def.baseVersion, entityUuid: clientEntity.uuid, datasetName: dataset.name });
      else
        throw Problem.user.entityNotFound({ entityUuid: clientEntity.uuid, datasetName: dataset.name });
    }

    return maybeDef.get();

  } else {
    // there is a branchId, look up the appropriate base def

    let condition;
    if (clientEntity.def.baseVersion === 1) // Special case
      condition = { version: 1 };
    else if (clientEntity.def.baseVersion === clientEntity.def.trunkVersion) // Start of an offline branch
      condition = { version: clientEntity.def.baseVersion };
    else // middle of an offline branch
      condition = { branchId: clientEntity.def.branchId, branchBaseVersion: clientEntity.def.baseVersion - 1 };

    const baseEntityVersion = await Entities.getDef(dataset.id, clientEntity.uuid, new QueryOptions({ condition }));

    if (baseEntityVersion.isEmpty()) {
      if (forceOutOfOrderProcessing) {
        // If the base version doesn't exist but we forcing the update anyway, use the latest version on the server as the base.
        // If that can't be found, throw an error for _processSubmissionEvent to catch so it can try create instead of update.
        const latestEntity = await Entities.getById(dataset.id, clientEntity.uuid)
          .then(getOrReject(Problem.user.entityNotFound({ entityUuid: clientEntity.uuid, datasetName: dataset.name })));
        return latestEntity.aux.currentVersion;
      } else {
        // If there is no base version and we are not forcing the processing, hold submission in the backlog.
        await Entities._holdSubmission(event, submissionDef.submissionId, submissionDef.id, clientEntity.uuid, clientEntity.def.branchId, clientEntity.def.baseVersion);
        return null;
      }
    }

    // Return the base entity version
    return baseEntityVersion.get();
  }
};

////////////////////////////////////////////////////////////////////////////////
// PROCESSING A SUBMISSION TO CREATE OR UPDATE AN ENTITY

// Helper function
const _getFormDefActions = (oneFirst, datasetId, formDefId) => oneFirst(sql`
  SELECT actions
  FROM dataset_form_defs
  WHERE "datasetId" = ${datasetId} AND "formDefId" = ${formDefId}`);

// Main submission event processing function, which runs within a transaction
// so any errors can be rolled back and logged as an entity processing error.
const _processSubmissionEvent = (event, parentEvent) => async ({ Datasets, Entities, Submissions, Forms, oneFirst, run }) => {
  const { submissionId, submissionDefId } = event.details;
  const forceOutOfOrderProcessing = parentEvent?.details?.force === true;

  const form = await Forms.getByActeeId(event.acteeId);
  // If form is deleted/purged then submission won't be there either.
  if (form.isEmpty())
    return null;

  const existingEntity = await Entities.getDefBySubmissionId(submissionId);
  // If the submission has already been used to make an entity, don't try again
  // and don't log it as an error.
  if (existingEntity.isDefined())
    return null;

  const existingHeldSubmission = await Entities._checkHeldSubmission(submissionId);
  // If the submission is being held for ordering offline entity processing,
  // don't try to process it now, it will be dequeued and reprocessed elsewhere.
  if (existingHeldSubmission.isDefined())
    return null;

  const submission = await Submissions.getSubAndDefById(submissionDefId);

  // If Submission is deleted/purged - Safety check, will not be true at this line
  if (submission.isEmpty())
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

  // Check that the form permits the entity action(s) specified in the
  // submission.
  const permittedActions = await _getFormDefActions(oneFirst, dataset.id, submissionDef.formDefId);
  for (const action of ['create', 'update']) {
    const submissionAction = entityData.system[action];
    if ((submissionAction === '1' || submissionAction === 'true') &&
      !permittedActions.includes(action))
      throw Problem.user.entityActionNotPermitted({ action, permitted: permittedActions });
  }

  // One reason why locking the entity is important here is that there may be
  // multiple unprocessed submissions that create or update the same entity.
  // That's especially true for offline branches. There could be an issue if two
  // workers attempted to concurrently process two different submissions that
  // affect the same entity. See https://github.com/getodk/central/issues/705
  await _lockEntity(run, normalizeUuid(entityData.system.id));

  let maybeEntity = null;
  // Try update before create (if both are specified)
  if (entityData.system.update === '1' || entityData.system.update === 'true')
    try {
      maybeEntity = await Entities._updateEntity(dataset, entityData, submissionId, submissionDef, submissionDefId, event, forceOutOfOrderProcessing);
    } catch (err) {
      const attemptCreate = (entityData.system.create === '1' || entityData.system.create === 'true') || forceOutOfOrderProcessing;
      // The two types of errors for which we attempt to create after a failed update:
      // 1. entity not found
      // 2. baseVersion is empty and failed to parse in the update case
      // This second one is a special case related to issue c#727
      if ((err.problemCode === 404.8 || (err.problemCode === 400.2 && err.problemDetails.field === 'baseVersion')) && attemptCreate) {
        maybeEntity = await Entities._createEntity(dataset, entityData, submissionId, submissionDef, submissionDefId, event, parentEvent, forceOutOfOrderProcessing);
      } else {
        throw (err);
      }
    }
  else if (entityData.system.create === '1' || entityData.system.create === 'true') {
    try {
      maybeEntity = await Entities._createEntity(dataset, entityData, submissionId, submissionDef, submissionDefId, event, parentEvent, forceOutOfOrderProcessing);
    } catch (err) {
      // There was a problem creating the entity
      // If it is a uuid collision, check if the entity was created via an update
      // in which case its ok to apply this create as an update
      if (err.problemCode === 409.3 && err.problemDetails?.fields[0] === 'uuid') {
        const rootDef = await Entities.getDef(dataset.id, entityData.system.id, new QueryOptions().withCondition({ root: true })).then(o => o.orNull());
        if (rootDef && rootDef.aux.source.forceProcessed) {
          maybeEntity = await Entities._updateEntity(dataset, entityData, submissionId, submissionDef, submissionDefId, event, forceOutOfOrderProcessing, true);
        } else {
          throw (err);
        }
      } else {
        throw (err);
      }
    }
  }

  // Check for held submissions that follow this one in the same branch
  if (maybeEntity != null) {
    const { uuid: entityUuid } = maybeEntity;
    const { branchId, branchBaseVersion } = maybeEntity.aux.currentVersion;
    // branchBaseVersion could be undefined if handling an offline create
    const currentBranchBaseVersion = branchBaseVersion ?? 0;
    const nextSub = await Entities._getNextHeldSubmissionInBranch(entityUuid, branchId, currentBranchBaseVersion + 1);

    if (nextSub.isDefined() && !forceOutOfOrderProcessing) {
      const { submissionId: nextSubmissionId, submissionDefId: nextSubmissionDefId, auditId } = nextSub.get();
      await Entities._deleteHeldSubmissionByEventId(auditId);
      await Entities.logBacklogEvent('reprocess', event, nextSubmissionId, nextSubmissionDefId);
    }
  }

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


////////////////////////////////////////////////////////////////////////////////
// Submission processing helper functions

// Used by _updateEntity to determine if a new offline update is contiguous with its trunk version
// by searching for an interrupting version with a different or null branchId that has a higher
// version than the trunk version of the given branch.
const _interruptedBranch = (entityId, clientEntity) => async ({ maybeOne }) => {
  // If there is no branchId, the branch cannot be interrupted
  if (clientEntity.def.branchId == null)
    return false;

  // look for a version of a different branch that has a version
  // higher than the trunkVersion, which indicates an interrupting version.
  // if trunkVersion is null (becuase it is part of a branch beginning with
  // an offline create), look for a version higher than 1 because version
  // 1 is implicitly the create action of that offline branch.
  const interruptingVersion = await maybeOne(sql`
  SELECT version
  FROM entity_defs
  WHERE "branchId" IS DISTINCT FROM ${clientEntity.def.branchId}
    AND version > ${clientEntity.def.trunkVersion || 1}
    AND "entityId" = ${entityId}
    LIMIT 1`);
  return interruptingVersion.isDefined();
};

// Used by _computeBaseVersion to hold submissions that are not yet ready to be processed
const _holdSubmission = (event, submissionId, submissionDefId, entityUuid, branchId, branchBaseVersion) => async ({ run, Entities }) => {
  await Entities.logBacklogEvent('hold', event, submissionId, submissionDefId);
  await run(sql`
  INSERT INTO entity_submission_backlog ("auditId", "submissionId", "submissionDefId", "entityUuid", "branchId", "branchBaseVersion", "loggedAt")
  VALUES (${event.id}, ${submissionId}, ${submissionDefId}, ${entityUuid}, ${branchId}, ${branchBaseVersion}, CLOCK_TIMESTAMP())
  `);
};

// Check for a currently-held submission by id
const _checkHeldSubmission = (submissionId) => ({ maybeOne }) => maybeOne(sql`
  SELECT * FROM entity_submission_backlog
  WHERE "submissionId"=${submissionId}`);

// Look up the next submission to process
const _getNextHeldSubmissionInBranch = (entityUuid, branchId, branchBaseVersion) => ({ maybeOne }) => (
  (branchId == null)
    ? maybeOne(sql`
      SELECT * FROM entity_submission_backlog
      WHERE "entityUuid" = ${entityUuid} AND "branchBaseVersion" = 1`)
    : maybeOne(sql`
      SELECT * FROM entity_submission_backlog
      WHERE "branchId"=${branchId} AND "branchBaseVersion" = ${branchBaseVersion}`));

// Delete a submission from the backlog
const _deleteHeldSubmissionByEventId = (eventId) => ({ run }) => run(sql`
  DELETE FROM entity_submission_backlog
  WHERE "auditId"=${eventId}`);

const logBacklogEvent = (action, event, submissionId, submissionDefId) => ({ Audits }) =>
  Audits.log({ id: event.actorId }, `submission.backlog.${action}`, { acteeId: event.acteeId }, { submissionId, submissionDefId });

////////////////////////////////////////////////////////////////////////////////
// FORCE PROCESSING SUBMISSIONS FROM BACKLOG

// Submissions that have been held in the backlog for longer than 5 days
// will be force-processed, including out-of-order updates and updates
// applied as entity creates.
const DAY_RANGE = config.has('default.taskSchedule.entitySubmissionBacklog')
  ? config.get('default.taskSchedule.entitySubmissionBacklog')
  : 5; // Default is 5 days

const _getHeldSubmissionsAsEvents = (force) => ({ all }) => all(sql`
  SELECT audits.* FROM entity_submission_backlog
  JOIN audits on entity_submission_backlog."auditId" = audits.id
  ${force ? sql`` : sql`WHERE entity_submission_backlog."loggedAt" < current_date - cast(${DAY_RANGE} as int)`}
  ORDER BY "branchId", "branchBaseVersion"`)
  .then(map(construct(Audit)));

const _processSingleBacklogEvent = (event) => (container) =>
  container.db.transaction(async (trxn) => {
    const { Entities } = container.with({ db: trxn });
    await Entities._deleteHeldSubmissionByEventId(event.id);
    await Entities.logBacklogEvent('force', event, event.details.submissionId, event.details.submissionDefId);
    await Entities.processSubmissionEvent(event, { details: { force: true } });
    return true;
  });

const processBacklog = (force = false) => async (container) => {
  const events = await container.Entities._getHeldSubmissionsAsEvents(force);
  await runSequentially(events.map(event =>
    () => container.Entities._processSingleBacklogEvent(event)));
  return events.length;
};

////////////////////////////////////////////////////////////////////////////////
// PROCESSING PENDING SUBMISSIONS FROM TOGGLING DATASET APPROVALREQUIRED FLAG

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
    LEFT JOIN (
      SELECT submission_defs.* FROM submission_defs
      JOIN submissions ON submission_defs."submissionId" = submissions.id
      JOIN forms ON submissions."formId" = forms.id
      WHERE submissions."deletedAt" IS NULL AND forms."deletedAt" IS NULL
    ) as submission_defs on submission_defs.id = entity_def_sources."submissionDefId"
    LEFT JOIN (
      SELECT submissions.*, submission_defs."userAgent" FROM submissions
      JOIN submission_defs ON submissions.id = submission_defs."submissionId" AND root
    ) submissions ON submissions.id = submission_defs."submissionId"
    LEFT JOIN forms ON submissions."formId" = forms.id
  `} 
  WHERE ${sqlEquals(options.condition)} AND entities."deletedAt" is ${deleted ? sql`not` : sql``} null
  ORDER BY entities."createdAt" DESC, entities.id DESC
`);
};

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

const _getDef = extender(Entity.Def, Entity.Def.Source)(Actor.into('creator'))((fields, extend, options) => sql`
  SELECT ${fields} FROM entities
  JOIN entity_defs ON entities.id = entity_defs."entityId"
  LEFT JOIN entity_def_sources ON entity_defs."sourceId" = entity_def_sources."id"
  ${extend||sql`
    LEFT JOIN actors ON actors.id=entity_defs."creatorId"
  `}
  where ${sqlEquals(options.condition)} AND entities."deletedAt" IS NULL
  order by entity_defs."createdAt", entity_defs.id
`);

const getDef = (datasetId, uuid, options = QueryOptions.none) => ({ maybeOne }) =>
  _getDef(maybeOne, options.withCondition({ datasetId, uuid }));

const getAllDefs = (datasetId, uuid, options = QueryOptions.none) => ({ all }) =>
  _getDef(all, options.withCondition({ datasetId, uuid }))
    .then(map((v) => new Entity.Def(v, { creator: v.aux.creator, source: v.aux.source })));

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
// RESOLVE CONFLICT

const resolveConflict = (entity, dataset) => ({ one }) => // eslint-disable-line no-unused-vars
  one(sql`UPDATE entities SET conflict=NULL, "updatedAt"=CLOCK_TIMESTAMP() WHERE "id"=${entity.id} RETURNING *`)
    .then(r => entity.with({ conflict: r.conflict, updatedAt: r.updatedAt }));

resolveConflict.audit = (entity, dataset) => (log) => log('entity.update.resolve', dataset, {
  entityId: entity.id,
  entityDefId: entity.aux.currentVersion.id,
  entity: { uuid: entity.uuid, dataset: dataset.name }
});

////////////////////////////////////////////////////////////////////////////////
// SERVING ENTITIES

const _exportUnjoiner = unjoiner(Entity, Entity.Def, Actor.alias('actors', 'creator'));

const streamForExport = (datasetId, options = QueryOptions.none) => ({ stream }) =>
  stream(sql`
SELECT ${_exportUnjoiner.fields} FROM entity_defs
INNER JOIN entities ON entities.id = entity_defs."entityId"
LEFT JOIN actors ON entities."creatorId"=actors.id
${options.skiptoken ? sql`
  INNER JOIN
  ( SELECT id, "createdAt" FROM entities WHERE "uuid" = ${options.skiptoken.uuid}) AS cursor
  ON entities."createdAt" <= cursor."createdAt" AND entities.id < cursor.id
  `: sql``} 
WHERE
  entities."datasetId" = ${datasetId}
  AND ${odataExcludeDeleted(options.filter, odataToColumnMap)}
  AND entity_defs.current=true
  AND  ${odataFilter(options.filter, odataToColumnMap)}
${options.orderby ? sql`
  ${odataOrderBy(options.orderby, odataToColumnMap, 'entities.id')}
  `: sql`ORDER BY entities."createdAt" DESC, entities.id DESC`}
${page(options)}`)
    .then(stream.map(_exportUnjoiner));

const countByDatasetId = (datasetId, options = QueryOptions.none) => ({ one }) => one(sql`
SELECT * FROM

(
  SELECT count(*) count FROM entities
  WHERE "datasetId" = ${datasetId}
  AND ${odataExcludeDeleted(options.filter, odataToColumnMap)}
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
  AND ${odataExcludeDeleted(options.filter, odataToColumnMap)}
  AND  ${odataFilter(options.filter, odataToColumnMap)}
) AS skiptoken`);


////////////////////////////////////////////////////////////////////////////////
// DELETE ENTITY

const del = (entity) => ({ run }) =>
  run(markDeleted(entity));

del.audit = (entity, dataset) => (log) =>
  log(
    'entity.delete',
    entity.with({ acteeId: dataset.acteeId }),
    { entity: { uuid: entity.uuid } }
  );

////////////////////////////////////////////////////////////////////////////////
// RESTORE ENTITY

const restore = (entity) => ({ run }) =>
  run(markUndeleted(entity));

restore.audit = (entity, dataset) => (log) =>
  log(
    'entity.restore',
    entity.with({ acteeId: dataset.acteeId }),
    { entity: { uuid: entity.uuid } }
  );

////////////////////////////////////////////////////////////////////////////////
// PURGE DELETED ENTITIES

const _trashedFilter = (force, projectId, datasetName, entityUuid) => {
  const idFilters = [sql`TRUE`];
  if (projectId) idFilters.push(sql`datasets."projectId" = ${projectId}`);
  if (datasetName) idFilters.push(sql`datasets."name" = ${datasetName}`);
  if (entityUuid) idFilters.push(sql`entities."uuid" = ${entityUuid}`);

  const idFilter = sql.join(idFilters, sql` AND `);

  return (force
    ? sql`entities."deletedAt" IS NOT NULL AND ${idFilter}`
    : sql`entities."deletedAt" < CURRENT_DATE - CAST(${PURGE_DAY_RANGE} AS INT) AND ${idFilter}`);
};

const forAudits = pipe(
  reduceBy((acc, r) => acc.concat(r.uuid), [], r => r.acteeId),
  toPairs,
  map(([ acteeId, entityUuids ]) => ({ acteeId, details: { entitiesDeleted: entityUuids.length, entityUuids } })),
  JSON.stringify,
);

const purge = (force = false, projectId = null, datasetName = null, entityUuid = null) => async ({ all, run }) => {
  if (entityUuid && (!projectId || !datasetName)) {
    throw Problem.internal.unknown({ error: 'Must specify projectId and datasetName to purge a specify entity.' });
  }
  if (datasetName && !projectId) {
    throw Problem.internal.unknown({ error: 'Must specify projectId to purge all entities of a dataset/entity-list.' });
  }

  // Delete relevant entities, returning their dataset IDs
  const deletedEntities = await all(sql`
    DELETE FROM entities
      USING datasets
      WHERE entities."datasetId" = datasets.id
        AND ${_trashedFilter(force, projectId, datasetName, entityUuid)}
      RETURNING entities.uuid
              , datasets."acteeId"
  `);

  if (!deletedEntities.length) return 0;

  const sqlEntityUuids = sql.join(deletedEntities.map(e => e.uuid), sql`,`);

  // Redact existing audits
  //
  // Reminder: 'notes' in audit table is set by 'x-action-notes' header of all
  // APIs with side-effects. Although we don't provide any way to set it from
  // the frontend (as of 2024.3), it is a good idea to clear it for purged
  // entities.
  await run(sql`
    UPDATE audits
      SET notes = NULL
      WHERE (audits.details->'entity'->>'uuid') IN (${sqlEntityUuids})
  `);

  // Delete orphaned entity sources
  await run(sql`
    DELETE
      FROM entity_def_sources AS src
      WHERE NOT EXISTS (
        SELECT 1 FROM entity_defs WHERE "sourceId" = src.id
      )
  `);

  // Delete submission backlog
  await run(sql`
    DELETE FROM entity_submission_backlog
      WHERE "entityUuid" IN (${sqlEntityUuids})
  `);

  // Add entity.purge audit log entries
  await run(sql`
    INSERT INTO audits ("action", "acteeId", "loggedAt", "processed", "details")
      SELECT 'entity.purge'
           , "acteeId"
           , clock_timestamp()
           , clock_timestamp()
           , details
        FROM JSONB_TO_RECORDSET(${forAudits(deletedEntities)})
        AS ("acteeId" UUID, "details" JSONB)
  `);

  return deletedEntities.length;
};

////////////////////////////////////////////////////////////////////////////////
// INTEGRITY CHECK

const idFilter = (options) => {
  const query = options.ifArg('id', ids => sql`uuid IN (${sql.join(ids.split(',').map(id => sql`${id.trim()}`), sql`, `)})`);
  return query.sql ? query : sql`TRUE`;
};

const _getAllEntitiesState = (datasetId, options) => sql`
  SELECT uuid, "deletedAt" IS NOT NULL as deleted 
  FROM entities 
  WHERE "datasetId" = ${datasetId}
  AND ${idFilter(options)}
  UNION
  SELECT uuid, deleted FROM (
    SELECT jsonb_array_elements_text(details -> 'entityUuids') AS uuid, TRUE as deleted
    FROM audits
    JOIN datasets ON datasets."acteeId" = audits."acteeId"
    WHERE action = 'entity.purge' 
    AND datasets.id = ${datasetId}
  ) purged
  WHERE ${idFilter(options)}
  -- union with not approved
`;

const getEntitiesState = (datasetId, options = QueryOptions.none) =>
  ({ all }) => all(_getAllEntitiesState(datasetId, options));

module.exports = {
  createNew, _processSubmissionEvent,
  createSource,
  createMany,
  _createEntity, _updateEntity,
  _computeBaseVersion, _interruptedBranch,
  _holdSubmission, _checkHeldSubmission,
  _getNextHeldSubmissionInBranch, _deleteHeldSubmissionByEventId,
  _getHeldSubmissionsAsEvents, logBacklogEvent,
  processBacklog, _processSingleBacklogEvent,
  processSubmissionEvent, streamForExport,
  getDefBySubmissionId,
  createVersion,
  countByDatasetId, getById, getDef,
  getAll, getAllDefs, del,
  createEntitiesFromPendingSubmissions,
  resolveConflict, restore, purge, getEntitiesState
};
