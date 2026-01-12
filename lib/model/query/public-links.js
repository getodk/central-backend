// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Frame, readable } = require('../frame');
const { Actor, PublicLink } = require('../frames');
const { extender, sqlEquals, QueryOptions } = require('../../util/db');
const Option = require('../../util/option');

const create = (publicLink, form) => ({ Actors, Assignments, Sessions }) =>
  Actors.createSubtype(publicLink.with({ formId: form.id }), form)
    .then((pl) => Promise.all([
      // eventually this might not happen automatically (eg scheduled links):
      Sessions.create(pl.actor, new Date('9999-12-31T23:59:59z')),
      Assignments.grantSystem(pl.actor, 'pub-link', form)
    ])
      .then(([ session ]) => pl.withAux('session', Option.of(session))));

create.audit = (pl) => (log) => log('public_link.create', pl.actor, { data: pl });
create.audit.withResult = true;

const _get = extender(PublicLink, Actor, Frame.define('token', readable))(Actor.alias('created_by', 'createdBy'))((fields, extend, options) => sql`
select ${fields} from public_links
join actors on public_links."actorId"=actors.id
left outer join sessions on public_links."actorId"=sessions."actorId"
${extend|| sql`join actors as created_by on public_links."createdBy"=created_by.id`}
where actors."deletedAt" is null and ${sqlEquals(options.condition)}
order by (sessions.token is not null) desc, actors."createdAt" desc`);

const getAllForForm = (form, options) => ({ all }) =>
  _get(all, options.withCondition({ formId: form.id }));

const getByFormAndActorId = (formId, actorId, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ formId, 'actors.id': actorId }));

module.exports = { create, getAllForForm, getByFormAndActorId };

