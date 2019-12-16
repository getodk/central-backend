// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const verbs = [
  'form.read'
];

const up = (db) =>
  db.schema
    .alterTable('roles', (roles) => roles.string('system', 15).alter())
    .then(() =>
      db
        .insert({ name: 'Form Viewer', system: 'form-viewer', verbs: JSON.stringify(verbs) })
        .into('roles'));

const down = (db) =>
  db.delete().from('roles').where({ system: 'form-viewer' })
    .then(() => db.schema.alterTable('roles', (roles) => roles.string('system', 8).alter()));

module.exports = { up, down };

