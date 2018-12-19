// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { resultCount } = require('../../util/db');

module.exports = {
  create: (actor) => ({ actees, simply }) =>
    actees.provision(actor.type)
      .then((actee) => simply.create('actors', actor.with({ acteeId: actee.id }))),

  // Probably poorly named; this has nothing to do with X-Extended-Metadata responses.
  // Instead, it is a helper that given any Instance that contains an actor: Actor
  // property will create bot the Actor as well as that Instance in a transaction.
  createExtended: (extended, extendedTable) => ({ actors, simply }) =>
    actors.create(extended.actor)
      .then((savedActor) => simply.create(extendedTable, extended.with({ actor: savedActor }))
        .then((savedExtended) => savedExtended.with({ actor: savedActor }))),

  getById: (id) => ({ simply, Actor }) =>
    simply.getOneWhere('actors', { id, deletedAt: null }, Actor),

  // permissions queries:
  assignRole: (actorId, roleId, acteeId) => ({ db }) =>
    db.insert({ actorId, roleId, acteeId }).into('assignments').then(() => true),

  can: (actor, verb, actee) => ({ db }) =>
    db.count('*')
      .from('assignments')
      .where({ actorId: actor.id })
      .whereIn('acteeId', actee.acteeIds())
      .innerJoin(
        db.select('*').from('grants').where({ verb }).as('granted'),
        'assignments.roleId', 'granted.roleId'
      )
      .limit(1)
      .then(resultCount)
      .then((count) => count > 0)
};

