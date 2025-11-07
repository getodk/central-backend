// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Actor } = require('../frames');
const { construct } = require('../../util/util');

// TODO: maybe configure expiration, probably configure role/assignments
// This is similar to how field key create works -- it just makes an api key with no real assignments and with linked project
// Actually field key create also makes a session but this doesnt do that...
// The API user makes the session later when they exchange the key for the token.
const create = (ak, project) => ({ Actors }) =>
  Actors.createSubtype(ak.with({ projectId: project.id }), project);

create.audit = (result) => (log) => log('api_key.create', result.actor);
create.audit.withResult = true;

const getActor = (key) => ({ maybeOne }) =>
  maybeOne(sql`select * from actors
    join api_keys on api_keys."actorId" = actors.id
    where api_keys.key=${key}`)
    .then(map(construct(Actor)));

module.exports = { create, getActor };

