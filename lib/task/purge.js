// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { task } = require('./task');

const purgeTask = task.withContainer((container) => (options = {}) => container.transacting(async ({ Blobs, Forms, Submissions }) => {
  let message;

  try {
    if (options.mode === 'submissions' || options.instanceId) {
      const count = await Submissions.purge(options.force, options.projectId, options.xmlFormId, options.instanceId);
      message = `Submissions purged: ${count}`;
    } else if (options.mode === 'forms' || (options.formId || options.xmlFormId)) {
      const count = await Forms.purge(options.force, options.formId, options.projectId, options.xmlFormId);
      message = `Forms purged: ${count}`;
    } else {
      const formCount = await Forms.purge(options.force, options.formId, options.projectId, options.xmlFormId);
      const submissionCount = await Submissions.purge(options.force, options.projectId, options.xmlFormId, options.instanceId);
      message = `Forms purged: ${formCount}, Submissions purged: ${submissionCount}`;
    }
  } catch (error) {
    return error.problemDetails.error;
  }

  await Blobs.purgeUnattached();
  return message;
}));

module.exports = { purgeTask };
