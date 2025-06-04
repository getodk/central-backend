// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { Actor, Session } = require('../frames');
const { resolve, reject } = require('../../util/promise');
const Option = require('../../util/option');
const Problem = require('../../util/problem');

const _impliedActees = (acteeId) => sql`
with recursive implied(id) as (
  (select ${acteeId}::varchar) union
  (select unnest(ARRAY[ parent, species ]) from actees
    join implied on implied.id=actees.id))`;

const _verbClause = (verbs) => sql.join(Array.from(verbs).map(v => sql`verbs ? ${v}`), sql` or `);

const can = (actor, verbs, actee) => ({ oneFirst }) => {
  const acteeId = actee.acteeId || actee;

  const verbsSet = new Set(typeof verbs === 'string' ? [verbs] : verbs);

  if (actor.acteeId === acteeId) {
    // special privileges actors always get on themselves.
    if ((verbsSet.has('user.read')) || (verbsSet.has('user.update')))
      return resolve(true);

    // all actors except app users can always log themselves out.
    // (public links cannot reach this route.)
    if ((verbsSet.has('session.end')) && (actor.type !== 'field_key'))
      return resolve(true);
  }

  return oneFirst(sql`
${_impliedActees(acteeId)}
select count(*)>0 from assignments
inner join implied on implied.id=assignments."acteeId"
inner join (select id from roles where ${_verbClause(verbsSet)}) as role on role.id=assignments."roleId"
where "actorId"=${actor.id}
  `);
};

const canAssignRole = (actor, role, actee) => ({ Auth }) =>
  Auth.verbsOn(actor.id, actee).then((hasArray) => {
    const has = new Set(hasArray);
    // `open_form` is subset of `form` so if someone has grant access on `form`
    // they should be able do it on `open_form` as well
    if (has.has('form.list')) has.add('open_form.list');
    if (has.has('form.read')) has.add('open_form.read');
    for (const required of role.verbs) if (!has.has(required)) return false;
    return true;
  });

const verbsOn = (actorId, actee) => ({ allFirst }) => {
  const acteeId = actee.acteeId || actee;

  return allFirst(sql`
    ${_impliedActees(acteeId)}
    SELECT DISTINCT JSONB_ARRAY_ELEMENTS_TEXT(verbs)
      FROM roles
      INNER JOIN (
        SELECT "roleId"
          FROM assignments
          INNER JOIN implied ON implied.id=assignments."acteeId"
          WHERE "actorId"=${actorId}
        ) AS assignments ON assignments."roleId"=roles.id
  `);
};


////////////////////////////////////////////////////////////////////////////////
// AUTH "INSTANCE"

// we provide a local object with basic auth methods on it, for ease of call
// (it's sort of a lot to ask people to Auth.canOrReject(maybeactor, … when
// the existing call pattern can just be serviced and is shorter and prevalent anyway)
const emptyAuth = Object.freeze({
  can() { return resolve(false); },
  canOrReject(x, y) {
    if (y === undefined) return () => reject(Problem.user.insufficientRights());
    return reject(Problem.user.insufficientRights());
  },
  canAssignRole() { return resolve(false); },
  verbsOn() { return resolve([]); },
  session: Option.none(),
  actor: Option.none(),
  isAuthenticated: false
});

// actor is required. session may or may not exist.
const actorAuth = (actor, session, Auth) => Object.freeze({
  can(verb, actee) { return Auth.can(actor, verb, actee); },
  canOrReject(verb, actee) {
    if (actee === undefined) return (a) => this.canOrReject(verb, a);
    return Auth.can(actor, verb, actee)
      .then((result) => ((result === true) ? actee : reject(Problem.user.insufficientRights())));
  },
  canAssignRole(role, actee) { return Auth.canAssignRole(actor, role, actee); },
  verbsOn(actee) { return Auth.verbsOn(actor.id, actee); },
  session: Option.of(session),
  actor: Option.of(actor),
  isAuthenticated: true
});

// the actual interface, which determines what sort of response to compose.
const by = (x) => ({ Auth }) => (
  (x instanceof Session) ? actorAuth(x.actor, x, Auth) :
  (x instanceof Actor) ? actorAuth(x, undefined, Auth) : // eslint-disable-line indent
  emptyAuth // eslint-disable-line indent
);


module.exports = { can, canAssignRole, verbsOn, by };

