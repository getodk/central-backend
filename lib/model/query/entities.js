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

// Entrypoint to where submissions (a specific version) become entities
const processSubmissionDef = (submissionDefId) => ({ Datasets, Entities, Submissions }) =>
  Submissions.getDefById(submissionDefId).then((s) => s.get())
    .then((submissionDef) => Datasets.getFieldsByFormDefId(submissionDef.formDefId)
      .then((fields) => Entity.fromSubmissionXml(submissionDef.xml, fields)
        .then((partial) => Entities.createNew(partial, submissionDef))));


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


module.exports = { createNew, processSubmissionDef, streamForExport };
