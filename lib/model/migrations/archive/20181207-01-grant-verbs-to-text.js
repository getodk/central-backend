// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) =>
  db.raw('alter table grants drop constraint grants_pkey')
    .then(() => db.schema.table('grants', (grants) => {
      grants.text('verb').notNull().alter();
    }))
    .then(() => db.raw('alter table grants add primary key ("actorId", verb, "acteeId")'));

const down = (db) =>
  db.raw('alter table grants add primary key ("actorId", verb, "acteeId")')
    .then(() => db.schema.table('grants', (grants) => {
      grants.string('verb', 16).notNull().alter();
    }))
    .then(() => db.raw('alter table grants drop constraint grants_pkey'));

module.exports = { up, down };

