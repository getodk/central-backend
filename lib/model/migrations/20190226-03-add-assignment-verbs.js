// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { without } = require('ramda');

const roleVerbs = [ 'role.assign', 'role.unassign' ]; // rm up; create down
const assignmentVerbs = [
  'assignment.list', 'assignment.create', 'assignment.delete'
]; // rm down; create up

const up = async (db) => {
  const [{ verbs }] = await db.select('verbs').from('roles').where({ system: 'admin' });
  const newVerbs = without(roleVerbs, verbs).concat(assignmentVerbs);
  await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system: 'admin' });
};

const down = async (db) => {
  const [{ verbs }] = await db.select('verbs').from('roles').where({ system: 'admin' });
  const newVerbs = without(assignmentVerbs, verbs).concat(roleVerbs);
  await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system: 'admin' });
};

module.exports = { up, down };

