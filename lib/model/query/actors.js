// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { flatten, uniq, map, compose } = require('ramda');
const { insert } = require('../../util/db');
const { resolve } = require('../../util/promise');
const { Actor } = require('../frames');

const create = (actor) => ({ Actees, one }) =>
  Actees.provision(actor.type)
    .then((actee) => one(insert(actor.with({ acteeId: actee.id, createdAt: new Date() }))))
    .then(Actor.construct);

const createSubtype = (sub) => ({ one }) =>
  create(sub.actor)
    // TODO/SL used to be this id reference was done in #forCreate. is this enough?
    .then((savedActor) => one(insert(sub.with({ actorId: savedActor.id })))
      .then(sub.constructor.construct)
      .then((savedSub) => savedSub.extend('actor', savedActor)));

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

const can = (actor, verb, actee) => ({ oneFirst }) => {
  resolve(actee.acteeIds()).then((acteeIds) => oneFirst(sql`
select count(*) from assignments
where "actorId"=${actor.id} and "acteeId" in ${sql.array(acteeIds)}
inner join (select id from roles where verbs ? ${verb}) as role on role.id=assignments."roleId"
limit 1`)
    .then((count) => count > 0));

const verbsOn = (actorId, actee) => ({ all }) =>
  resolve(actee.acteeIds()).then((acteeIds) => all(sql`
select verbs from roles
inner join (select "roleId" from assignments
  where "actorId"=${actorId} and "acteeId" in ${sql.array(acteeIds)})
  as assignments
  on assignments."roleId"=roles.id`)
    // TODO: it miiiiight be possible to make postgres do this work?
    .then(compose(uniq, flatten, map((r) => r.verbs)));


module.exports = { create, createExtended, getById, extraActeeIdsFor, can, verbsOn };

