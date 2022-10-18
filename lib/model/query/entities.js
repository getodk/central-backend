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
const Problem = require('../../util/problem');
const { map } = require('ramda');
const { construct } = require('../../util/util');

////////////////////////////////////////////////////////////////////////////////
// ENTITY CREATE

// Submission-defining entitiies contain the dataset name as a string
// so we will look up the dataset id by name (unique within a project)
// and project id (from submission def -> submission -> form def -> form)
const _getDataset = (dsName, subDefId) => sql`
SELECT datasets."id", sd."id" as "subDefId" FROM
submission_defs AS sd
  JOIN form_defs AS fd ON sd."formDefId" = fd."id"
  JOIN forms AS f ON fd."formId" = f."id"
  JOIN datasets ON datasets."projectId" = f."projectId"
WHERE datasets."name" = ${dsName} AND sd."id" = ${subDefId}`;

const _defInsert = (id, partial, subDefId, json) => sql`insert into entity_defs ("entityId", "submissionDefId", "data", "current", "createdAt")
  values (${id}, ${subDefId}, ${json}, true, clock_timestamp())
  returning *`;
const nextval = sql`nextval(pg_get_serial_sequence('entities', 'id'))`;

// creates both the entity and its initial entity def in one go.
const createNew = (partial, subDef) => ({ one }) => {
  const json = JSON.stringify(partial.def.data);
  return one(sql`
with def as (${_defInsert(nextval, partial, subDef.id, json)}),
ds as (${_getDataset(partial.aux.dataset, subDef.id)}),
ins as (insert into entities (id, "datasetId", "uuid", "label", "createdAt", "createdBy")
  select def."entityId", ds."id", ${partial.uuid}, ${partial.label}, def."createdAt", ${subDef.submitterId} from def
  join ds on ds."subDefId" = def."submissionDefId"
  returning entities.*)
select ins.*, def.id as "entityDefId" from ins, def;`)
    .then(({ entityDefId, ...entityData }) => // TODO/HACK: reassembly inspired by Submissions.createNew
      new Entity(entityData, {
        def: new Entity.Def({
          id: entityDefId,
          entityId: entityData.id,
          submissionDefId: subDef.id,
          createdAt: entityData.createdAt,
          data: partial.def.data
        })
      }));
};

// TODO: add and tests entity creation audit logging and error handling (failed validation, etc.)

// HACK: This is a function to check if the entity *can* successfully be inserted
// because without it... in the case of processing an entity within a worker,
// the database hits its constraints and then breaks the rest of the transaction.
// Then it won't do things like update the processing time on the relevant audit log event,
// and I can't log any more errors :(
const canInsertEntity = (datasetName, submissionDefId, entityUuid) => ({ one }) =>
  one(sql`
  WITH dataset AS (
    SELECT datasets."id", sd."id" as "subDefId" FROM
    submission_defs AS sd
      JOIN form_defs AS fd ON sd."formDefId" = fd."id"
      JOIN forms AS f ON fd."formId" = f."id"
      JOIN datasets ON datasets."projectId" = f."projectId"
    left outer join entities on datasets."id" = entities."datasetId"
    WHERE datasets."name" = ${datasetName} AND sd."id" = ${submissionDefId}
    LIMIT 1),
  entity AS (
    SELECT entities."datasetId", entities."uuid", entities."id" from entities
    WHERE entities."uuid" = ${entityUuid}
  )
  select dataset."id" as "datasetId", entity."id" as "entityId" from dataset
  FULL OUTER JOIN entity
    ON dataset."id" = entity."datasetId"`)
    .then(({ datasetId, entityId }) =>
      (datasetId !== null && entityId == null));

// Entrypoint to where submissions (a specific version) become entities
const processSubmissionDef = (submissionDefId) => ({ Datasets, Entities, Submissions }) =>
  new Promise((resolve, reject) => {
    Entities.getDefBySubmissionDefId(submissionDefId)
      .then((def) =>
        (def.isDefined()
          ? reject(Problem.user.entityViolation({ reason: 'This submission was already used to create an entity.' }))
          : Submissions.getDefById(submissionDefId).then((s) => s.get())))
      .then((submissionDef) => Datasets.getFieldsByFormDefId(submissionDef.formDefId)
        .then((fields) =>
          ((fields.length === 0)
            ? resolve()
            : Entity.fromSubmissionXml(submissionDef.xml, fields)
              .then((partial) =>
                Entities.canInsertEntity(partial.aux.dataset, submissionDefId, partial.uuid)
                  .then((okToInsert) =>
                    (okToInsert
                      ? Entities.createNew(partial, submissionDef)
                        .then((entity) => resolve(entity))
                        .catch((err) => reject(Problem.user.entityViolation({ reason: 'Entity could not be created', err: err.problemDetails })))
                      : reject(Problem.user.entityViolation({ reason: 'It is not possible to create an entity from this data.' })))))
              .catch((problem) => reject(problem)))));
  });


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


module.exports = { createNew, processSubmissionDef, streamForExport, getDefBySubmissionDefId, getByUuid, canInsertEntity };
