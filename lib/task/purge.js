// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { task } = require('./task');

const purgeTask = task.withContainer((container) => async (options = {}) => {
  // Form/submission purging will happen within its own transaction
  const message = await container.db.transaction(async trxn => {
    const { Forms, Submissions, Entities } = container.with({ db: trxn });
    try {
      if (options.mode === 'entities' || options.datasetName || options.entityUuid) {
        const count = await Entities.purge(options.force, options.projectId, options.datasetName, options.entityUuid);
        return `Entities purged: ${count}`;
      }
      if (options.mode === 'submissions' || options.instanceId) {
        const count = await Submissions.purge(options.force, options.projectId, options.xmlFormId, options.instanceId);
        return `Submissions purged: ${count}`;
      } else if (options.mode === 'forms' || (options.formId || options.xmlFormId)) {
        const count = await Forms.purge(options.force, options.formId, options.projectId, options.xmlFormId);
        return `Forms purged: ${count}`;
      } else {
        // Purge all Forms, Submissions and Entities according to options
        const formCount = await Forms.purge(options.force, options.formId, options.projectId, options.xmlFormId);
        const submissionCount = await Submissions.purge(options.force, options.projectId, options.xmlFormId, options.instanceId);
        const entitiesCount = await Entities.purge(options.force, options.projectId, options.datasetName, options.entityUuid);

        // Related to form purging: deletes draft form defs that are not in use by any form and have no associated submission defs
        await Forms.clearUnneededDrafts();

        return `Forms purged: ${formCount}, Submissions purged: ${submissionCount}, Entities purged: ${entitiesCount}`;
      }
    } catch (error) {
      return error?.problemDetails?.error;
    }
  });

  // Purging unattached blobs is outside of the above transaction because it
  // may interact with an external blob store.
  await container.Blobs.purgeUnattached();
  return message;
});

module.exports = { purgeTask };
