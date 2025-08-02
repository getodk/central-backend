// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { assoc, map } = require('ramda');
const { Actor, Session } = require('../frames');
const { generateToken, isValidToken } = require('../../util/crypto');
const { unjoiner } = require('../../util/db');
const { construct } = require('../../util/util');
const Option = require('../../util/option');

const aDayFromNow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
};

const create = (actor, expiresAt = aDayFromNow()) => ({ one }) => one(sql`
insert into sessions ("actorId", token, csrf, "createdAt", "expiresAt")
values (${actor.id}, ${generateToken()}, ${generateToken()}, clock_timestamp(), ${expiresAt.toISOString()})
returning *`)
  .then(construct(Session));

const _unjoiner = unjoiner(Session, Actor);
const getByBearerToken = (token) => ({ maybeOne }) => (isValidToken(token) ? maybeOne(sql`
  SELECT "sessions"."csrf" AS "sessions!csrf"
       , "actors"."id" AS "actors!id"
       , "actors"."type" AS "actors!type"
       , "actors"."acteeId" AS "actors!acteeId"
    FROM sessions
    JOIN actors ON actors.id=sessions."actorId"
    WHERE token=${token}
      AND sessions."expiresAt" > NOW()
      AND actors."deletedAt" IS NULL
`)
  .then(map(auth => assoc('sessions!token', token, auth)))
  .then(map(_unjoiner)) : Promise.resolve(Option.none()));

const getLifetime = ({ token }) => ({ maybeOne }) => (isValidToken(token) ? maybeOne(sql`
  SELECT "createdAt"
       , "expiresAt"
    FROM sessions
    WHERE token=${token}
      AND sessions."expiresAt" > NOW()
`) : Promise.resolve(Option.none()));

const terminateByActorId = (actorId, current = undefined) => ({ run }) =>
  run(sql`DELETE FROM sessions WHERE "actorId"=${actorId}
${current == null ? sql`` : sql`AND token <> ${current}`}`);

const terminate = (session) => ({ run }) =>
  run(sql`delete from sessions where token=${session.token}`);

terminate.audit = (session) => (log) => {
  // don't audit user logouts, since they're just normal user actions.
  if (session.actor.type === 'user') return;
  const prefix = (session.actor.type != null) ? `${session.actor.type}.` : '';
  return log(`${prefix}session.end`, session.actor);
};

const reap = () => ({ run }) =>
  run(sql`delete from sessions where "expiresAt" < now()`);

module.exports = { create, getByBearerToken, getLifetime, terminateByActorId, terminate, reap };

