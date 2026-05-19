// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//

const { v4: uuid } = require('uuid');

const up = (knex) =>
  knex.schema.createTable('field_keys', (fk) => {
    fk.integer('actorId').primary();
    fk.integer('createdBy').notNull();

    fk.foreign('actorId').references('actors.id');
    fk.foreign('createdBy').references('actors.id');
  }).then(() =>
    knex.insert({ id: uuid(), species: 'system' }).into('actees').returning('id')
      .then(([ id ]) => id)
      .then((acteeId) => knex.insert({ type: 'system', displayName: 'Global Field Keys', systemId: 'globalfk', acteeId })
        .into('actors').returning('id'))
      .then(([ id ]) => id)
      .then((actorId) => knex.insert({ actorId, verb: 'createSubmission', acteeId: 'form', system: true }).into('grants'))
      .then(() => knex.insert({ id: 'field_key', species: 'species' }).into('actees')));

const down = (knex) => knex.schema.dropTable('field_keys');

module.exports = { up, down };

