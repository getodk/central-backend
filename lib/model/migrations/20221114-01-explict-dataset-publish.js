// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('entity_defs', (eDef) => {
    eDef.integer('submissionDefId').alter({ nullable: true });
  });

  await db.schema.table('datasets', (ds) => {
    ds.dateTime('publishedAt');
  });

  await db.schema.table('ds_properties', (dsProp) => {
    dsProp.dateTime('publishedAt');
  });
};

const down = async (db) => {
  await db.schema.table('entity_defs', (eDef) => {
    eDef.integer('submissionDefId').alter({ nullable: false });
  });

  await db.schema.table('datasets', (ds) => {
    ds.dropColumn('publishedAt');
  });

  await db.schema.table('ds_properties', (dsProp) => {
    dsProp.dropColumn('publishedAt');
  });
};

module.exports = { up, down };
