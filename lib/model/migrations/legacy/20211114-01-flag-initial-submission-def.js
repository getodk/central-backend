// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('submission_defs', (sds) => {
    sds.boolean('root');
  });
  await db.raw(`update submission_defs set root=true
  where id in (select min(id) from submission_defs group by "submissionId")`);
};

const down = (db) => db.schema.table('submission_defs', (sds) => {
  sds.dropColumn('root');
});

module.exports = { up, down };

