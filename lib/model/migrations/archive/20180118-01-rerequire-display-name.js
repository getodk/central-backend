// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//

const up = (knex) =>
  knex.raw('update actors set "displayName"=(select email from users where users."actorId"=actors.id) where "displayName" is null and type=\'user\';')
    .then(() => knex.schema.table('actors', (actors) => actors.string('displayName', 64).notNullable().alter()));

const down = (knex) =>
  knex.schema.table('actors', (actors) => actors.string('displayName', 64).nullable().alter());

module.exports = { up, down };

