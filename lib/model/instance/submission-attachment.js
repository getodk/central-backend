// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Attachments are supplemental files associated with Submissions. Each Submission
// may have zero or many Attachments. The actual file information is stored and
// accessed via Blobs in the blobs table; Attachments are the join entity that relates
// Submissions to Blobs.

const Instance = require('./instance');

module.exports = Instance('submission_attachments', {
  all: [ 'submissionDefId', 'blobId', 'name', 'index' ]
})(({ SubmissionAttachment, simply, submissionAttachments }) => class {
  forApi() { return { name: this.name, exists: (this.blobId != null) }; }

  clear() { submissionAttachments.update(this.with({ blobId: null })); }

  static getBySubmissionDefIdAndName(submissionDefId, name) {
    return simply.getOneWhere('submission_attachments', { submissionDefId, name }, SubmissionAttachment);
  }
  static streamByFormId(formId) { return submissionAttachments.streamByFormId(formId); }
});

