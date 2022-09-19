// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) =>
  db.schema.createTable('entities', (entities) => {
    entities.increments('id').primary();
    entities.string('uuid').notNull();
    entities.integer('datasetId');
    entities.text('label').notNull();
    entities.dateTime('createdAt');

    entities.foreign('datasetId').references('datasets.id');
    entities.unique(['uuid']);
    // entities.unique(['label', 'datasetId']); // unique label per dataset ??
  }).then(() =>
    db.schema.createTable('entity_defs', (eDef) => {
      eDef.increments('id').primary();
      eDef.integer('entityId').notNull();
      eDef.dateTime('createdAt');
      eDef.boolean('current');
      eDef.integer('submissionDefId').notNull();
      eDef.jsonb('data');

      eDef.foreign('entityId').references('entities.id');
      eDef.foreign('submissionDefId').references('submission_defs.id');
      // unique?
    }));

const down = (db) =>
  db.schema.dropTable('entity_defs')
    .then(() => db.schema.dropTable('entities'));

module.exports = { up, down };
