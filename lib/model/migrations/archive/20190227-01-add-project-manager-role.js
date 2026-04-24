// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const verbs = [
  'project.read', 'project.update', 'project.delete',
  'form.create', 'form.delete', 'form.list', 'form.read', 'form.update',
  'submission.create', 'submission.read', 'submission.list', 'submission.update',
  'field_key.create', 'field_key.delete', 'field_key.list',
  'assignment.list', 'assignment.create', 'assignment.delete'
];

const up = (db) => db.insert({ name: 'Project Manager', system: 'manager', verbs: JSON.stringify(verbs) }).into('roles');
const down = (db) => db.delete().from('roles').where({ system: 'manager' });

module.exports = { up, down };

