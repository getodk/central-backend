// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Attachments are supplemental files associated with Submissions. Each Submission
// may have zero or many Attachments. The actual file information is stored and
// accessed via Blobs in the blobs table; Attachments are the join entity that relates
// Submissions to Blobs.

const Instance = require('./instance');

module.exports = Instance(({ Attachment, simply }) => class {
  forApi() { return this.name; }

  static getBySubmission(submissionId, name) {
    return simply.getOneWhere('attachments', { submissionId, name }, Attachment);
  }
});

