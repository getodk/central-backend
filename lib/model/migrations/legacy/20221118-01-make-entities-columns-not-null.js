// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('datasets', (datasets) => {
    datasets.dateTime('createdAt').notNull().alter();
  });

  await db.schema.table('ds_property_fields', (dsPropertyFields) => {
    dsPropertyFields.dropUnique(['dsPropertyId', 'formDefId', 'path']);
    dsPropertyFields.unique(['dsPropertyId', 'formDefId']);
  });

  await db.schema.table('entities', (entities) => {
    entities.dateTime('createdAt').notNull().alter();
  });

  await db.schema.table('entity_defs', (eDef) => {
    eDef.dateTime('createdAt').notNull().alter();
    eDef.jsonb('data').notNull().alter();
    eDef.unique(['entityId', 'submissionDefId']);
  });

};
const down = async (db) => {
  await db.schema.table('datasets', (datasets) => {
    datasets.dateTime('createdAt').alter();
  });

  await db.schema.table('ds_property_fields', (dsPropertyFields) => {
    dsPropertyFields.dropUnique(['dsPropertyId', 'formDefId']);
    dsPropertyFields.unique(['dsPropertyId', 'formDefId', 'path']);
  });

  await db.schema.table('entities', (entities) => {
    entities.dateTime('createdAt').alter();
  });

  await db.schema.table('entity_defs', (eDef) => {
    eDef.dateTime('createdAt').alter();
    eDef.jsonb('data').alter();
    eDef.dropUnique(['entityId', 'submissionDefId']);
  });
};

module.exports = { up, down };
