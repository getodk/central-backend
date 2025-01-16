// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = (db) => db.schema
  .raw('create extension if not exists pg_trgm')
  .then(() => Promise.all([
    db.schema.raw('create index actors_displayname_gist_index on actors using gist ("displayName" gist_trgm_ops)'),
    db.schema.raw('create index users_email_gist_index on users using gist (email gist_trgm_ops)')
  ]));

const down = (db) => Promise.all([
  db.schema.raw('drop index actors_displayname_gist_index'),
  db.schema.raw('drop index users_email_gist_index')
]);

module.exports = { up, down };

