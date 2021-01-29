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
const { Session } = require('../frames');
const Option = require('../../util/option');

const aDayFromNow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
};

const create = (actor, expiresAt = aDayFromNow()) => ({ one }) => one(sql`
insert into sessions ("actorId", token, csrf, "expiresAt")
values (${actor.id}, ${generateToken()}, ${generateToken()}, ${expiresAt}`);

const getByBearerToken = (token) => ({ maybeOne }) =>
  maybeOne(sql`select * from sessions where token=${token} and "expiresAt" > now()`)
    .then(map(Session.construct));

const deleteByActorId = (actorId) => ({ run }) =>
  run(sql`delete from sessions where "actorId"=${actorId}`);

const reap = () => ({ run }) =>
  run(sql`delete from sessions where "expiresAd" < now()`);

module.exports = { create, getByBearerToken, deleteByActorId, reap };

