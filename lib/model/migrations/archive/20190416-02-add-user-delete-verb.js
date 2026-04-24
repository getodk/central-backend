// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Currently, we write audit logs to the database. This makes it easy to use them
// in determining, for example, the most recent login by a User. To log an audit
// record, use Audit.log().

const { without } = require('ramda');

const up = async (db) => {
  const [{ verbs }] = await db.select('verbs').from('roles').where({ system: 'admin' });
  const newVerbs = verbs.concat([ 'user.delete' ]);
  await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system: 'admin' });
};

const down = async (db) => {
  const [{ verbs }] = await db.select('verbs').from('roles').where({ system: 'admin' });
  const newVerbs = without([ 'user.delete' ], verbs);
  await db.update({ verbs: JSON.stringify(newVerbs) }).into('roles').where({ system: 'admin' });
};

module.exports = { up, down };

