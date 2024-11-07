// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Actor, Assignment } = require('../frames');
const { extender, sqlEquals, QueryOptions } = require('../../util/db');
const { getOrReject } = require('../../util/promise');
const Problem = require('../../util/problem');
const { construct } = require('../../util/util');

const _grant = (actor, roleId, acteeId) => ({ one }) => one(sql`
insert into assignments ("actorId", "roleId", "acteeId")
values (${actor.id}, ${roleId}, ${acteeId})
returning *`)
  .then(construct(Assignment));

_grant.audit = (actor, roleId, acteeId) => (log) => {
  if (actor.type === 'singleUse') return null;
  return log(`${actor.type}.assignment.create`, actor, { roleId, grantedActeeId: acteeId });
};

const grant = (actor, role, actee) => ({ Assignments }) => Assignments._grant(
  actor,
  (role.id == null) ? role : role.id,
  (actee.acteeId == null) ? actee : actee.acteeId
);

const grantSystem = (actor, systemName, actee) => ({ Assignments, Roles }) =>
  Roles.getBySystemName(systemName)
    .then(getOrReject(Problem.internal.missingSystemRow('role')))
    .then((role) => Assignments.grant(actor, role, actee));

const _revoke = (actor, roleId, acteeId) => ({ db }) =>
  db.query(sql`delete from assignments where ${sqlEquals({ actorId: actor.id, roleId, acteeId })}`)
    .then(({ rowCount }) => Number(rowCount) > 0);

_revoke.audit = (actor, roleId, acteeId) => (log) => {
  if (actor.type === 'singleUse') return null;
  return log(`${actor.type}.assignment.delete`, actor, { roleId, revokedActeeId: acteeId });
};

const revoke = (actor, role, actee) => ({ Assignments }) => Assignments._revoke(
  actor,
  (role.id == null) ? role : role.id,
  (actee.acteeId == null) ? actee : actee.acteeId
);


const revokeByActorId = (actorId) => ({ run }) =>
  run(sql`delete from assignments where "actorId"=${actorId}`);
const revokeByActeeId = (acteeId) => ({ run }) =>
  run(sql`delete from assignments where "acteeId"=${acteeId}`);


const _get = extender(Assignment)(Actor)((fields, extend, options) => sql`
select ${fields} from assignments
  ${extend|| sql`inner join actors on actors.id=assignments."actorId"`}
  where ${sqlEquals(options.condition)}`);
const getByActeeId = (acteeId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ 'assignments.acteeId': acteeId }));
const getByActeeAndRoleId = (acteeId, roleId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ 'assignments.acteeId': acteeId, roleId }));

const _getForForms = extender(Assignment, Assignment.FormSummary)(Actor)((fields, extend, options) => sql`
select ${fields} from assignments
inner join forms on forms."acteeId"=assignments."acteeId"
${extend|| sql`inner join actors on actors.id=assignments."actorId"`}
where ${sqlEquals(options.condition)}
and forms."deletedAt" is null`);
const getForFormsByProjectId = (projectId, options = QueryOptions.none) => ({ all }) =>
  _getForForms(all, options.withCondition({ projectId }));
const getForFormsByProjectAndRoleId = (projectId, roleId, options = QueryOptions.none) => ({ all }) =>
  _getForForms(all, options.withCondition({ projectId, roleId }));


module.exports = {
  _grant, grant, grantSystem,
  _revoke, revoke, revokeByActorId, revokeByActeeId,
  getByActeeId, getByActeeAndRoleId,
  getForFormsByProjectId, getForFormsByProjectAndRoleId
};

