// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const createEntityFromSubmission = ({ Entities }, event) => {
  if (event.details.reviewState === 'approved' && event.details.submissionDefId) {
    return Entities.processSubmissionDef(event.details.submissionDefId)
      .catch((problem) => {
        // eslint-disable-next-line no-console
        console.log('Problem successfully caught by entity worker:', problem);
        // TODO: log error
        // e.g. Audits.log({ id: event.actorId }, 'submission.process.entity', { acteeId: event.acteeId }, { problem })
        // Complication If the db transaction is broken here, I can't log the error in the DB
      });
  }
};

module.exports = { createEntityFromSubmission };

