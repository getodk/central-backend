// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
const up = (knex) =>
  knex.schema.createTable('field_keys', (fk) => {
    fk.integer('actorId').primary();
    fk.integer('createdBy').notNull();

    fk.foreign('actorId').references('actors.id');
    fk.foreign('createdBy').references('actors.id');
  }).then(() => {
    const { Actee, Actor, Grant, simply } = require('../package').withDefaults({ db: knex });
    return (new Actor({ type: 'system', displayName: 'Global Field Keys', systemId: 'globalfk' }))
      .create()
      .then(({ id }) => simply.create('grants', new Grant({ actorId: id, verb: 'createSubmission', acteeId: 'form', system: true })))
      .then(() => (new Actee({ id: 'field_key', species: 'species' })).create());
  });
const down = (knex) => knex.schema.dropTable('field_keys');

module.exports = { up, down };

