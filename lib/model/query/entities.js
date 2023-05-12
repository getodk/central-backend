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

////////////////////////////////////////////////////////////////////////////////
// ENTITY CREATE

const _defInsert = (id, subDefId, creatorId, userAgent, label, json) => sql`insert into entity_defs ("entityId", "submissionDefId", "creatorId", "userAgent", "label", "data", "current", "createdAt")
  values (${id}, ${subDefId}, ${creatorId}, ${userAgent}, ${label}, ${json}, true, clock_timestamp())
  returning *`;
const nextval = sql`nextval(pg_get_serial_sequence('entities', 'id'))`;

// Creates both the entity and its initial entity def in one go.
// Note: the logging of this action will happen elsewhere, not with the usual
// createNew.audit mechanism because this is called by a worker rather than a
// standard authenticated API request. The worker has better access to the event
// actor/initiator and actee/target so it will do the logging itself (including
// error logging).
const createNew = (dataset, partial, subDef, userAgentIn) => ({ one, context }) => {
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
with def as (${_defInsert(nextval, subDefId, creatorId, userAgent, partial.def.label, json)}),
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
        }),
        dataset
      }));
};


createNew.audit = (newEntity, dataset, partial, subDef) => (log) => {
  if (!subDef)
    return log('entity.create', newEntity.aux.dataset, {
      entityId: newEntity.id, // Added in v2023.3 - not backfilled
      entity: { uuid: newEntity.uuid, label: newEntity.aux.currentVersion.label, dataset: newEntity.aux.dataset.name }
    });
};
createNew.audit.withResult = true;


// Entrypoint to where submissions (a specific version) become entities
const _processSubmissionDef = (event) => async ({ Datasets, Entities, Submissions, Forms }) => {
  const { submissionDefId, submissionId } = event.details;
  const existingEntity = await Entities.getDefBySubmissionId(submissionId);
  // If the submission has already been used to make an entity, don't try again
  // and don't log it as an error.
  if (existingEntity.isDefined())
    return null;
  const submissionDef = await Submissions.getDefById(submissionDefId).then((s) => s.get());
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
    throw Problem.user.entityViolation({ reason: 'Dataset empty or missing.' });
  }
  const form = await Forms.getByActeeId(event.acteeId);
  const dataset = (await Datasets.get(form.get().projectId, entityData.system.dataset, true))
    .orThrow(Problem.user.entityViolation({ reason: `Dataset [${entityData.system.dataset}] not found` }));

  if (dataset && dataset.approvalRequired && event.details.reviewState !== 'approved')
    return null;

  // If create is not true (either 1 or true) then we don't need to process further
  if (!(entityData.system.create === '1' || entityData.system.create === 'true'))
    return null;

  const partial = await Entity.fromParseEntityData(entityData);

  return Entities.createNew(dataset, partial, submissionDef);
};

const processSubmissionEvent = (event) => (container) =>
  container.db.transaction((trxn) =>
    container.with({ db: trxn }).Entities._processSubmissionDef(event))
    .then((entity) => {
      if (entity != null) {
        return container.Audits.log({ id: event.actorId }, 'entity.create', { acteeId: entity.aux.dataset.acteeId },
          {
            entityId: entity.id, // Added in v2023.3 - not backfilled
            eventId: event.id, // Added in v2023.3 - not backfilled
            entity: { uuid: entity.uuid, label: entity.aux.currentVersion.label, dataset: entity.aux.dataset.name },
            submissionId: event.details.submissionId,
            submissionDefId: event.details.submissionDefId
          });
      }
    })
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


////////////////////////////////////////////////////////////////////////////////
// UPDATING ENTITIES

const createVersion = (dataset, entity, data, label, userAgentIn = null) => ({ context, one }) => {
  // dataset is passed in so the audit log can use its actee id
  const creatorId = context.auth.actor.map((actor) => actor.id).orNull();
  const userAgent = blankStringToNull(userAgentIn);
  const json = JSON.stringify(data);

  const _unjoiner = unjoiner(Entity, Entity.Def.into('currentVersion'));

  // TODO: revisit sources.
  // For now, attach a dummy 'api' entity def source to return for PATCH request.
  const source = new Entity.Def.Source({
    type: 'api',
    details: null
  });

  return one(sql`
  with def as (${_defInsert(entity.id, null, creatorId, userAgent, label, json)}),
  upd as (update entity_defs set current=false where entity_defs."entityId" = ${entity.id}),
  entities as (update entities set "updatedAt"=clock_timestamp()
    where "uuid"=${entity.uuid}
    returning *)
  select ${_unjoiner.fields} from def as entity_defs
  join entities on entity_defs."entityId" = entities.id
  `)
    .then(_unjoiner)
    .then((e) => e.withAux('currentVersion', e.aux.currentVersion.withAux('source', source)));
};

createVersion.audit = (newEntity, dataset, entity) => (log) =>
  log('entity.update.version', dataset, { entityId: entity.id, entityDefId: newEntity.aux.currentVersion.id, uuid: newEntity.uuid, dataset: dataset.name });
createVersion.audit.withResult = true;

////////////////////////////////////////////////////////////////////////////////
// GETTING ENTITIES

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
    LEFT JOIN submission_defs ON submission_defs.id = entity_defs."submissionDefId"
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

const getById = (datasetId, uuid, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(true)(maybeOne, options.withCondition({ datasetId, uuid }), isTrue(options.argData?.deleted))
    .then(map((entity) => {
      const isSourceSubmission = !!entity.aux.currentVersion.submissionDefId;

      // TODO: revisit this when working on POST /entities
      const source = new Entity.Def.Source({
        type: isSourceSubmission ? 'submission' : 'api',
        details: isSourceSubmission ? {
          xmlFormId: entity.aux.form.xmlFormId,
          instanceId: entity.aux.submission.instanceId,
          instanceName: entity.aux.submissionDef.instanceName
        } : null
      });

      const currentVersion = new Entity.Def(entity.aux.currentVersion, { creator: entity.aux.currentVersionCreator, source });

      return new Entity(entity, { currentVersion, creator: entity.aux.creator });
    }));

const getAll = (datasetId, options = QueryOptions.none) => ({ all }) =>
  _get(false)(all, options.withCondition({ datasetId }), isTrue(options.argData.deleted))
    .then(map((e) => e.withAux('currentVersion', e.aux.currentVersion.withAux('creator', e.aux.currentVersionCreator))));

////////////////////////////////////////////////////////////////////////////////
// GETTING ENTITY DEFS

const _getDef = extender(Entity.Def, Submission, Submission.Def.into('submissionDef'), Form)(Actor.into('creator'))((fields, extend, options) => sql`
  SELECT ${fields} FROM entities
  JOIN entity_defs ON entities.id = entity_defs."entityId"
  LEFT JOIN submission_defs ON submission_defs.id = entity_defs."submissionDefId"
  LEFT JOIN (
    SELECT submissions.*, submission_defs."userAgent" FROM submissions
    JOIN submission_defs ON submissions.id = submission_defs."submissionId" AND root
  ) submissions ON submissions.id = submission_defs."submissionId"
  LEFT JOIN forms ON submissions."formId" = forms.id
  ${extend||sql`
    LEFT JOIN actors ON actors.id=entity_defs."creatorId"
  `}
  where ${equals(options.condition)} AND entities."deletedAt" IS NULL
  order by entity_defs."createdAt", entity_defs.id
`);

const getAllDefs = (datasetId, uuid, options = QueryOptions.none) => ({ all }) =>
  _getDef(all, options.withCondition({ datasetId, uuid }))
    .then(map((v) => {
      const isSourceSubmission = !!v.submissionDefId;

      // TODO: revisit this when working on POST /entities
      const source = new Entity.Def.Source({
        type: isSourceSubmission ? 'submission' : 'api',
        details: isSourceSubmission ? {
          xmlFormId: v.aux.form.xmlFormId,
          instanceId: v.aux.submission.instanceId,
          instanceName: v.aux.submissionDef.instanceName
        } : null
      });

      return new Entity.Def(v, { creator: v.aux.creator, source });
    }));

// This will check for an entity related to any def of the same submission
// as the one specified. Used when trying to reapprove an edited submission.
const getDefBySubmissionId = (submissionId) => ({ maybeOne }) =>
  maybeOne(sql`select ed.* from submissions as s
  join submission_defs as sd on s."id" = sd."submissionId"
  join entity_defs as ed on ed."submissionDefId" = sd."id"
  where s.id = ${submissionId} limit 1`)
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
WHERE
  entities."datasetId" = ${datasetId}
  AND entity_defs.current=true
  AND  ${odataFilter(options.filter, odataToColumnMap)}
ORDER BY entities."createdAt" DESC, entities.id DESC
${page(options)}`)
    .then(stream.map(_exportUnjoiner));

const countByDatasetId = (datasetId, options = QueryOptions.none) => ({ oneFirst }) => oneFirst(sql`
SELECT count(*) FROM entities
  WHERE "datasetId" = ${datasetId}
  AND  ${odataFilter(options.filter, odataToColumnMap)}`);


////////////////////////////////////////////////////////////////////////////////
// DELETE ENTITY

const del = (entity) => ({ run }) =>
  run(markDeleted(entity));

del.audit = (entity, dataset) => (log) => log('entity.delete', entity.with({ acteeId: dataset.acteeId }), { uuid: entity.uuid });

module.exports = {
  createNew, _processSubmissionDef,
  processSubmissionEvent, streamForExport,
  getDefBySubmissionId,
  createVersion,
  countByDatasetId, getById,
  getAll, getAllDefs, del
};
