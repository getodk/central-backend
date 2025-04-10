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
  knex.raw('create unique index forms_xmlformid_deletedat_unique on forms ("xmlFormId") where "deletedAt" is null;')
    .then(() => knex.schema.table('forms', (forms) => {
      forms.dropUnique('xmlFormId');
      forms.unique([ 'xmlFormId', 'version' ]);
    }));

// this migration is provided but it /will not work/ in all scenarios!
// if it is failing for you, it is relatively safe to just skip it.
const down = () => (knex) =>
  knex.schema.table('forms', (forms) => {
    forms.dropUnique([ 'xmlFormId', 'version' ]);
    forms.unique('xmlFormId');
  }).then(() => knex.raw('drop index forms_xmlformid_deletedat_unique'));

module.exports = { up, down };

