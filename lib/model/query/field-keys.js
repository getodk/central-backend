// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Frame, readable } = require('../frame');
const { Actor, FieldKey } = require('../frames');
const { QueryOptions, extender, sqlEquals } = require('../../util/db');

const create = (fk, project) => ({ Actors, Sessions }) =>
  Actors.createSubtype(fk.with({ projectId: project.id }), project)
    .then((created) => Sessions.create(created.actor, new Date('9999-12-31T23:59:59z'))
      .then((session) => created.withAux('session', session)));

create.audit = (result) => (log) => log('field_key.create', result.actor);
create.audit.withResult = true;

const _get = extender(FieldKey, Actor, Frame.define('token', readable))(Actor.alias('created_by', 'createdBy'), Frame.define('lastUsed', readable))((fields, extend, options) => sql`
select ${fields} from field_keys
  join actors on field_keys."actorId"=actors.id
  left outer join sessions on field_keys."actorId"=sessions."actorId"
  ${extend|| sql`join actors as created_by on field_keys."createdBy"=created_by.id`}
  ${extend|| sql`left outer join
    (select "actorId", max("loggedAt") as "lastUsed" from audits
      where action='submission.create'
      group by "actorId") as last_usage
    on last_usage."actorId"=actors.id`}
  where ${sqlEquals(options.condition)} and actors."deletedAt" is null
  order by (sessions.token is not null) desc, actors."createdAt" desc`);

const getAllForProject = (project, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ projectId: project.id }));

const getByProjectAndActorId = (projectId, actorId, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ projectId, 'field_keys.actorId': actorId }));

module.exports = { create, getAllForProject, getByProjectAndActorId };

