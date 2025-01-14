// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { without } = require('ramda');

const up = async (db) => {
  const [{ verbs }] = await db.select('verbs').from('roles').where({ system: 'manager' });
  const newVerbs = verbs.concat([ 'session.end' ]);
  await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system: 'manager' });
};

const down = async (db) => {
  const [{ verbs }] = await db.select('verbs').from('roles').where({ system: 'manager' });
  const newVerbs = without([ 'session.end' ], verbs);
  await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system: 'manager' });
};

module.exports = { up, down };

