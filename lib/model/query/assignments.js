// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Actor, Assignment, Form } = require('../frames');
const { extender, equals, QueryOptions } = require('../../util/db');
const { getOrReject } = require('../../util/promise');
const Problem = require('../../util/problem');


const grant = (actor, role, actee) => ({ one }) => {
  const actorId = (actor.id == null) ? actor : actor.id;
  const roleId = (role.id == null) ? role : role.id;
  const acteeId = (actee.acteeId == null) ? actee : actee.acteeId;

  return one(sql`insert into assignments ("actorId", "roleId", "acteeId") values (${actorId}, ${roleId}, ${acteeId})`)
    .then(Assignment.construct);
};

const grantSystem = (actor, systemName, actee) => ({ Assignments, Roles }) =>
  Roles.getBySystemName(systemName)
    .then(getOrReject(Problem.internal.missingSystemRow('role')))
    .then((role) => Assignments.assignRole(role, actee));


const revoke = (actor, role, actee) => ({ run }) => {
  const actorId = (actor.id == null) ? actor : actor.id;
  const roleId = (role.id == null) ? role : role.id;
  const acteeId = (actee.acteeId == null) ? actee : actee.acteeId;

  return run(sql`delete from assignments where ${equals({ actorId, roleId, acteeId })}`);
};

const revokeByActorId = (actorId) => ({ run }) =>
  run(sql`delete from assignments where "actorId"=${actorId}`);
const revokeByActeeId = (acteeId) => ({ run }) =>
  run(sql`delete from assignments where "acteeId"=${acteeId}`);


const _get = extender(Assignment)(Actor)((fields, extend, options) => sql`
select ${fields} from assignments
  ${extend|| sql`inner join actors on actors.id=assignments."actorId"`}
  where ${equals(options.condition)}`);
const getByActeeId = (acteeId, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ 'assignments.acteeId': acteeId }));
const getByActeeAndRoleId = (acteeId, roleId, options) => ({ all }) =>
  _get(all, options.withCondition({ 'assignments.acteeId': acteeId, roleId }));

const _getForForms = extender(Assignment, Assignment.FormSummary)(Actor, Form)((fields, extend, options) => sql`
select ${fields} from assignments
inner join forms on forms."acteeId"=assignments."acteeId"
${extend|| sql`inner join actors on actors.id=assignments."actorId"`}
where ${equals(options.condition)}`);
const getForFormsByProjectId = (projectId, options = QueryOptions.none) => ({ all }) =>
  _getForForms(all, options.withCondition({ projectId }));
const getForFormsByProjectAndRoleId = (projectId, roleId, options = QueryOptions.none) => ({ all }) =>
  _getForForms(all, options.withCondition({ projectId, roleId }));


module.exports = {
  grant, grantSystem,
  revoke, revokeByActorId, revokeByActeeId,
  getByActeeId, getByActeeAndRoleId,
  getForFormsByProjectId, getForFormsByProjectAndRoleId
};

