// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Actor, User } = require('../frames');
const { hashPassword } = require('../../util/crypto');
const { unjoiner, page, sqlEquals, QueryOptions } = require('../../util/db');
const { reject } = require('../../util/promise');
const Problem = require('../../util/problem');

const create = (user) => ({ Actors }) => Actors.createSubtype(user);
create.audit = (user) => (log) => log('user.create', user.actor, { data: user });
create.audit.withResult = true;

// TODO: right now there are so few writable fields that it's far cheaper to
// just write queries that honor those fields than to create a generic utility.
const update = (user, data) => ({ run, one }) => {
  const merged = user.with(data);
  return Promise.all([
    run(sql`update users set email=${merged.email} where "actorId"=${merged.actor.id}`),
    run(sql`update actors set "displayName"=${merged.actor.displayName}, "updatedAt"=clock_timestamp() where id=${merged.actor.id}`)
  ])
    .then(() => one(_getSql(QueryOptions.none.withCondition({ actorId: user.actorId })))) // eslint-disable-line no-use-before-define
    .then(_unjoin); // eslint-disable-line no-use-before-define
};

update.audit = (user, data) => (log) => log('user.update', user.actor, { data: data.with(data.actor) });

const updatePassword = (user, cleartext) => ({ run }) =>
  hashPassword(cleartext)
    .then((hash) => run(sql`update users set password=${hash} where "actorId"=${user.actor.id}`));
updatePassword.audit = (user) => (log) => log('user.update', user.actor, { data: { password: true } });

const invalidatePassword = (user) => ({ Sessions, run }) => Promise.all([
  run(sql`update users set password=null where "actorId"=${user.actor.id}`),
  Sessions.terminateByActorId(user.actorId)
]);
invalidatePassword.audit = (user) => (log) => log('user.update', user.actor, {
  data: { password: null }
});

const provisionPasswordResetToken = (user) => ({ Actors, Assignments, Sessions }) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 1);
  const displayName = `Reset token for ${user.actor.id}`;
  const meta = { resetPassword: user.actor.id };
  return Actors.create(new Actor({ type: 'singleUse', expiresAt, displayName, meta }))
    .then((single) => Promise.all([
      Assignments.grantSystem(single, 'pwreset', user.actor),
      Sessions.create(single)
    ]))
    .then(([ , { token } ]) => token);
};

const _unjoin = unjoiner(User, Actor);
const _getSql = (options) => sql`
select ${_unjoin.fields} from users
join actors on users."actorId"=actors.id
${options.ifArg('q', (q) => sql`
  left join lateral
    greatest(word_similarity("displayName", ${q}) + similarity("displayName", ${q}),
      word_similarity(email, ${q}) + similarity(email, ${q})) as score on true`)}
where ${sqlEquals(options.condition)} and actors."deletedAt" is null
  ${options.ifArg('q', () => sql`and score > 0.5`)}
order by ${options.ifArg('q', () => sql`score desc,`)} email asc 
${page(options)}`;

const getAll = (options) => ({ all }) => all(_getSql(options)).then(map(_unjoin));

const getByEmail = (email, options = QueryOptions.none) => ({ maybeOne }) =>
  maybeOne(_getSql(options.withCondition({ email }))).then(map(_unjoin));

const getByActorId = (actorId, options = QueryOptions.none) => ({ maybeOne }) =>
  maybeOne(_getSql(options.withCondition({ actorId }))).then(map(_unjoin));

const emailEverExisted = (email) => ({ maybeOne }) =>
  maybeOne(sql`select true from users where email=${email} limit 1`)
    .then((user) => user.isDefined());

module.exports = {
  create, update,
  updatePassword, invalidatePassword, provisionPasswordResetToken,
  getAll, getByEmail, getByActorId,
  emailEverExisted
};

