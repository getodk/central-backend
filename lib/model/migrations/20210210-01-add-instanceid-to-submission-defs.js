// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.schema.table('submission_defs', (sds) => {
    sds.string('instanceId', 64).unique();
    sds.index([ 'submissionId', 'instanceId' ]);
    //sds.unique([ 'formDefId', 'instanceId' ]);
    // TODO/CR: is this how we want to do this? or do we want to fix the tests?
  });

  await db.raw(`
update submission_defs set "instanceId"=submissions."instanceId"
from submissions where submissions.id=submission_defs."submissionId"`);

  await db.raw('alter table submission_defs alter column "instanceId" set not null');
};

const down = (db) => db.schema.table('submission_defs', (sds) => {
  sds.dropColumn('instanceId');
});

module.exports = { up, down };

