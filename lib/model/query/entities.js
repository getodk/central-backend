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


const _defInsert = (id, partial, json) => sql`insert into entity_defs ("entityId", "submissionDefId", "data", "current", "createdAt")
  values (${id}, ${partial.def.submissionDefId}, ${json}, true, clock_timestamp())
  returning *`;

const nextval = sql`nextval(pg_get_serial_sequence('entities', 'id'))`;

const createNew = (partial) => ({ one }) => {
  const { datasetId } = partial;
  const json = JSON.stringify(partial.def.data);

  return one(sql`
with def as (${_defInsert(nextval, partial, json)}),
ins as (insert into entities (id, "datasetId", "uuid", "label", "createdAt")
  select def."entityId", ${datasetId}, ${partial.uuid}, ${partial.label}, def."createdAt" from def
  returning entities.*)
select ins.*, def.id as "entityDefId" from ins, def;`)
    .then(({ entityDefId, ...entityData }) => // TODO/HACK: (copied) reassembling this from bits and bobs.
      new Entity(entityData, {
        def: new Entity.Def({
          id: entityDefId,
          entityId: entityData.id,
          submissionDefId: partial.def.submissionDefId,
          createdAt: entityData.createdAt,
          data: entityData.data
        })
      }));
};

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


module.exports = { createNew, streamForExport };
