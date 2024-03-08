// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');

const { task } = require('./task');
const s3 = require('../util/s3');

// TODO for s3.enabled: blobs must be deleted within a locking db transaction to ensure that:
// i. a blob does not get re-used while it is being deleted from S3, and
// ii. an object is not deleted from S3 while it is being re-added to the blobs table
const purgeBlobs = async (db, Blobs) => {
  if (!s3.isEnabled()) return Blobs.purgeUnattached();

  const { unattachedClause } = Blobs;

  // eslint-disable-next-line no-await-in-loop
  while (await db.transaction(async tx => {
    const blob = await tx.one(sql`
      SELECT id, md5, sha
        FROM blobs AS b
        ${unattachedClause}
        FOR UPDATE
        LIMIT 1
    `);
    if (!blob) return;

    await s3.deleteObjFor(blob);

    const deleted = await tx.oneFirst(sql`
      DELETE FROM blobs
        USING blobs AS b
        ${unattachedClause}
          AND id=${blob.id}
        RETURNING TRUE
    `);
    if (!deleted) throw new Error(`Blob ${blob.id} has somehow become re-attached!`);

    return true;
  })) /* repeat until all uploaded */;
};

const purgeForms = task.withContainer(({ db, Blobs, Forms }) => async (force = false, formId = null, projectId = null, xmlFormId = null) => {
  const formCount = await Forms.purge(force, formId, projectId, xmlFormId);
  await purgeBlobs(db, Blobs);
  return formCount;
});

module.exports = { purgeForms };
