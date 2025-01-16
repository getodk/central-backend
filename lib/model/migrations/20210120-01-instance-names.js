// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Submission } = require('../frames');

const up = async (db) => {
  await db.schema.table('submission_defs', (sds) => {
    sds.text('instanceName');
  });

  const work = [];
  for await (const def of db.select('*').from('submission_defs').stream()) {
    const partial = await Submission.fromXml(def.xml);
    if (partial.def.instanceName == null) continue;

    // for some reason using await here hangs on 12.6.0
    const data = { instanceName: partial.def.instanceName };
    work.push(db.update(data).into('submission_defs').where({ id: def.id }));
  }
  await Promise.all(work);
};

const down = (db) => db.schema.table('submission_defs', (sds) => {
  sds.dropColumn('instanceName');
});

module.exports = { up, down };

