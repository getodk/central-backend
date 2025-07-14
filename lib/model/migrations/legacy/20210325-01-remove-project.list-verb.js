// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { without } = require('ramda');

/* eslint-disable no-await-in-loop */

const up = async (db) => {
  for (const system of [ 'admin', 'manager' ]) {
    const [{ verbs }] = await db.select('verbs').from('roles').where({ system });
    const newVerbs = without([ 'project.list' ], verbs);
    await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system });
  }
};

const down = async (db) => {
  for (const system of [ 'admin', 'manager' ]) {
    const [{ verbs }] = await db.select('verbs').from('roles').where({ system });
    const newVerbs = verbs.concat([ 'project.list' ]);
    await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system });
  }
};

module.exports = { up, down };

