// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { insert, markDeleted } = require('../../util/db');
const { resolve } = require('../../util/promise');
const { Actor } = require('../frames');
const { construct } = require('../../util/util');

// actor.type must be specified!
const create = (actor) => ({ Actees, one }) =>
  Actees.provision(actor.type)
    .then((actee) => one(insert(actor.with({ acteeId: actee.id, type: actor.type }))))
    .then(construct(Actor));

// actor.type will be inferred from sub@actorType if it is not explicitly set.
// only sub is required. parent will set up the parent relationship in the
// actee table if given, and is only used on field keys.
const createSubtype = (sub, parent) => ({ Actees, one }) => {
  const type = sub.actor.type || sub.constructor.actorType;
  return Actees.provision(type, parent)
    .then((actee) => one(insert(sub.actor.with({ acteeId: actee.id, type }))))
    .then(construct(Actor))
    .then((savedActor) => one(insert(sub.with({ actorId: savedActor.id })))
      .then(construct(sub.constructor))
      .then((savedSub) => savedSub.withAux('actor', savedActor)));
};

const consume = (actor) => ({ Actors }) =>
  ((actor.type === 'singleUse') ? Actors._del(actor) : resolve(false));

const _del = (actor) => ({ run, Assignments, Sessions }) => Promise.all([
  run(markDeleted(actor)),
  Assignments.revokeByActorId(actor.id),
  Sessions.terminateByActorId(actor.id)
]);
const del = (actor) => ({ Actors }) => Actors._del(actor);
del.audit = (actor) => (log) => log(`${actor.type}.delete`, actor);

const getById = (id) => ({ maybeOne }) =>
  maybeOne(sql`select * from actors where id=${id} and "deletedAt" is null`)
    .then(map(construct(Actor)));

module.exports = { create, createSubtype, consume, _del, del, getById };

