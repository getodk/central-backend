// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Actor, FieldKey, Session } = require('../frames');
const { QueryOptions, extender, equals } = require('../../util/db');
const Option = require('../../util/option');

const create = (fk) => ({ Actors, sessions }) =>
  Actors.createSubtype(fk)
    .then((created) => sessions.create(created)
      .then((session) => created.with({ session: Option.of(session) })));

const _get = extender(FieldKey, Actor, Option.of(Session))(Actor.alias('created_by'))((fields, extend, options) => sql`
select ${fields} from field_keys
  join actors on field_keys."actorId"=sessions."actorId"
  left outer join sessions on field_keys."actorId"=sessions."actorId"
  ${extend|| sql`join actors as created_by on field_keys."createdBy"=created_by.id`}
  ${extend|| sql`left outer join
    (select "actorId", max("loggedAt") as "lastUsed" from audits
      where action='submission.create'
      group by "actorId") as last_usage`}
  where ${equals(options.condition)} and actors."deletedAt" is null
  order by (sessions.token is not null) desc, actors."createdAt" desc`);

const getAllForProject = (project, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withConditions({ projectId: project.id }));

const getByActorIdForProject = (actorId, project, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ 'actors.id': actorId, projectId: project.id }));

module.exports = { create, getAllForProject, getByActorIdForProject };

