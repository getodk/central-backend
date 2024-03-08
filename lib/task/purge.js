// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { task } = require('./task');
const s3 = require('../util/s3');

const purgeForms = task.withContainer(({ Forms, Blobs }) => async (force = false, formId = null, projectId = null, xmlFormId = null) => {
  const formCount = await Forms.purge(force, formId, projectId, xmlFormId);
  await purgeBlobs(Blobs);
  return formCount;
};

module.exports = { purgeForms };

// TODO for s3.enabled: blobs must be deleted within a locking db transaction to ensure that:
// i. a blob does not get re-used while it is being deleted from S3, and
// ii. an object is not deleted from S3 while it is being re-added to the blobs table
async function purgeBlobs(Blobs) {
  if (!s3.isEnabled()) return Blobs.purgeUnattached();

  // TODO EXPLICITLY start a new transaction; make sure it's not contained in a different transaction

  const blob = await Blobs.selectUnattachedForUpdate();
  if (!blob) /* all purged */ return;

  await s3.deleteObjFor(blob);
  await Blobs.deleteUnattachedById(blob);
  if (!deleted) throw new Error(`Blob ${blob.id} has somehow become re-attached!`);

  // TODO commit transaction
}
