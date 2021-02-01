// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
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

const create = (actor) => ({ Actees, one }) =>
  Actees.provision(actor.type)
    .then((actee) => one(insert(actor.with({ acteeId: actee.id }))))
    .then(Actor.construct);

const createSubtype = (sub) => ({ one }) =>
  create(sub.actor)
    // TODO/SL used to be this id reference was done in #forCreate. is this enough?
    .then((savedActor) => one(insert(sub.with({ actorId: savedActor.id })))
      .then(sub.constructor.construct)
      .then((savedSub) => savedSub.extend('actor', savedActor)));

const update = (actor) => ({ one }) => one(update(actor));
const consume = (actor) => ({ Actors }) =>
  ((actor.type === 'singleUse') ? Actors.del(actor) : resolve(false));
const del = (actor) => ({ run }) => run(markDeleted(actor));


const getById = (id) => ({ maybeOne }) =>
  maybeOne(sql`select * from actors where id=${id} and "deletedAt" is null`)
    .then(map(Actor.construct));


// TODO: project permissions cascading needs to be more straightforward than this.
const extraActeeIdsFor = (actor) => ({ oneFirst, one }) => {
  if (actor.type === 'field_key') {
    return oneFirst(sql`
select projects.acteeId from projects
inner join field_keys on "actorId"=${actor.id} and field_keys."projectId"=projects.id`)
      .then((id) => [ id ]);
  } else if (actor.type === 'public_link') {
    return one(sql`
select projects."acteeId" as pai, forms."acteeId" as fai from forms
inner join public_links on "actorId"=${actor.id} and public_links."formId"=forms.id
inner join projects on projects.id=forms."projectId"`)
      .then(({ pai, fai }) => [ pai, fai ]);
  }
  return resolve([]);
};


module.exports = { create, createSubtype, update, consume, del, getById, extraActeeIdsFor };

