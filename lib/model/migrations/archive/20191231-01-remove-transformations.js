// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('form_defs', (defs) => { defs.dropColumn('transformationId'); });
  await db.schema.dropTable('transformations');
};

const down = async (db) => {
  await db.schema.createTable('transformations', (transformations) => {
    transformations.increments('id');
    transformations.string('system', 8).unique();
  });
  await db.insert([
    { system: 'identity' }, // all data is compatible as-is.
    { system: 'void' } // abandon all extant data as incompatible.
  ]).into('transformations');
  await db.schema.table('form_defs', (defs) => {
    defs.integer('transformationId');
    defs.foreign('transformationId').references('transformations.id');
  });
};

module.exports = { up, down };

