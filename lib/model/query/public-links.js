// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Actor, PublicLink, Session } = require('../frames');
const { QueryOptions, equals } = require('../../util/db');
const Option = require('../../util/option');

const create = (publicLink) => ({ Actors, Sessions }) =>
  Actors.createSubtype(publicLink)
    .then((pl) => Sessions.create(pl, '9999-12-31T23:59:59z') // eventually this might not happen automatically (eg scheduled links)
      .then((session) => pl.extend('session', Option.of(session))));

const _get = extender(PublicLink, Actor, Option.of(Session))(PublicLink.Extended, Actor.alias('created_by', 'createdBy'))((fields, extend, options) => sql`
select ${fields} from public_links
join actors on public_links."actorId"=actors.id
left outer join sessions on public_links."actorId"=sessions."actorId"
${extend|| sql`join actors as created_by on public_links."createdBy"=created_by.id`}
where actors."deletedAt" is null and ${equals(options.condition)}
order by (sessions.token is not null) desc, actors."createdAt" desc`);

const getAllForForm = (form, options) => ({ all }) =>
  _get(all, options.withCondition({ formId: form.id }));

const getByActorIdForForm = (actorId, form, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(all, options.withCondition({ 'actors.id': actorId, formId: form.id }));

module.exports = { create, getAllForForm, getByActorIdForForm };

