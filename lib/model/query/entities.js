// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Entity } = require('../frames');
const { unjoiner } = require('../../util/db');
const { map } = require('ramda');
const { construct } = require('../../util/util');

////////////////////////////////////////////////////////////////////////////////
// ENTITY CREATE

// Submission-defining entitiies contain the dataset name as a string
// so we will look up the dataset id by name (unique within a project)
// and project id (from submission def -> submission -> form def -> form)
const _getDataset = (dsName, subDefId) => sql`
SELECT datasets."id", sd."id" as "subDefId", datasets."acteeId", datasets."name"
FROM submission_defs AS sd
  JOIN form_defs AS fd ON sd."formDefId" = fd."id"
  JOIN forms AS f ON fd."formId" = f."id"
  JOIN datasets ON datasets."projectId" = f."projectId"
WHERE datasets."name" = ${dsName} AND sd."id" = ${subDefId}`;

const _defInsert = (id, partial, subDefId, json) => sql`insert into entity_defs ("entityId", "submissionDefId", "data", "current", "createdAt")
  values (${id}, ${subDefId}, ${json}, true, clock_timestamp())
  returning *`;
const nextval = sql`nextval(pg_get_serial_sequence('entities', 'id'))`;

// Creates both the entity and its initial entity def in one go.
// Note: the logging of this action will happen elsewhere, not with the usual
// createNew.audit mechanism because this is called by a worker rather than a
// standard authenticated API request. The worker has better access to the event
// actor/initiator and actee/target so it will do the logging itself (including
// error logging).
const createNew = (partial, subDef) => ({ one }) => {
  const json = JSON.stringify(partial.def.data);
  return one(sql`
with def as (${_defInsert(nextval, partial, subDef.id, json)}),
ds as (${_getDataset(partial.aux.dataset, subDef.id)}),
ins as (insert into entities (id, "datasetId", "uuid", "label", "createdAt", "createdBy")
  select def."entityId", ds."id", ${partial.uuid}, ${partial.label}, def."createdAt", ${subDef.submitterId} from def
  join ds on ds."subDefId" = def."submissionDefId"
  returning entities.*)
select ins.*, def.id as "entityDefId", ds."acteeId" as "dsActeeId", ds."name" as "dsName" from ins, def, ds;`)
    .then(({ entityDefId, dsActeeId, dsName, ...entityData }) => // TODO/HACK: reassembly inspired by Submissions.createNew
      new Entity(entityData, {
        def: new Entity.Def({
          id: entityDefId,
          entityId: entityData.id,
          submissionDefId: subDef.id,
          createdAt: entityData.createdAt,
          data: partial.def.data
        }),
        dataset: { acteeId: dsActeeId, name: dsName }
      }));
};


// Entrypoint to where submissions (a specific version) become entities
const _processSubmissionDef = (submissionDefId) => async ({ Datasets, Entities, Submissions }) => {
  const existingEntity = await Entities.getDefBySubmissionDefId(submissionDefId);
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
  const partial = await Entity.fromSubmissionXml(submissionDef.xml, fields);
  // If no data was returned, e.g. if create flag was not set, then don't continue
  if (!partial)
    return null;
  const entity = await Entities.createNew(partial, submissionDef);
  return entity;
};

const processSubmissionEvent = (event) => (container) =>
  container.db.transaction((trxn) =>
    container.with({ db: trxn }).Entities._processSubmissionDef(event.details.submissionDefId))
    .then((entity) => {
      if (entity != null) {
        return container.Audits.log({ id: event.actorId }, 'entity.create', { acteeId: entity.aux.dataset.acteeId },
          { entity: { uuid: entity.uuid, label: entity.label, dataset: entity.aux.dataset.name },
            submissionId: event.details.submissionId,
            submissionDefId: event.details.submissionDefId });
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
// GETTING ENTITIES

const getDefBySubmissionDefId = (submissionDefId) => ({ maybeOne }) =>
  maybeOne(sql`select * from entity_defs where "submissionDefId" = ${submissionDefId} limit 1`)
    .then(map(construct(Entity.Def)));

const getByUuid = (uuid) => ({ maybeOne }) =>
  maybeOne(sql`select * from entities where "uuid" = ${uuid} limit 1`)
    .then(map(construct(Entity)));


////////////////////////////////////////////////////////////////////////////////
// SERVING ENTITIES

const _exportUnjoiner = unjoiner(Entity, Entity.Def);

const streamForExport = (datasetId) => ({ stream }) =>
  stream(sql`
select ${_exportUnjoiner.fields} from entity_defs
inner join entities
  on entities.id = entity_defs."entityId"
where
  entities."datasetId" = ${datasetId}
  and entity_defs.current=true
order by entities.id`)
    .then(stream.map(_exportUnjoiner));


module.exports = { createNew, _processSubmissionDef, processSubmissionEvent, streamForExport, getDefBySubmissionDefId, getByUuid };
