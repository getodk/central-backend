// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Submissions are logical records: they contain some basic detail like instanceId
// and the submitter and deviceId, but all they indicate is the existence of a
// Submission by some instanceId. Each logical Submission will have one or more
// SubmissionVersions associated with it. The latest SubmissionVersion joined to
// a Submission is always the current canonical state of the Submission.
//
// All actual data, like the submission XML and attachments, are associated with
// the SubmissionVersion rather than the Submission.
//
// When Submissions are initially intaken, it is the SubmissionPartial class that
// does the xml parsing work. It also serves as the initial holding tank of information
// parsed out of the xml, which is a mix of Submission and SubmissionVersion data.


const { merge } = require('ramda');
const Instance = require('./instance');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { superproto } = require('../../util/util');


// TODO: add back lastSubmission, submissions (count)
const ExtendedSubmission = ExtendedInstance({
  fields: {
    readable: [ 'instanceId', 'submitter', 'deviceId', 'createdAt', 'updatedAt' ]
  },
  forApi() { return merge(superproto(this).forApi(), { submitter: this.submitter.forApi() }); }
});


module.exports = Instance.with(HasExtended(ExtendedSubmission))('submissions', {
  all: [ 'id', 'instanceId', 'submitterId', 'deviceId', 'createdAt', 'updatedAt', 'deletedAt' ],
  readable: [ 'instanceId', 'submitterId', 'deviceId', 'createdAt', 'updatedAt' ]
})(({ simply, submissions, submissionVersions }) => class {

  getCurrentVersion() { return submissionVersions.getCurrentBySubmissionId(this.id); }

  static getById(formId, instanceId, options) { return submissions.getById(formId, instanceId, options); }
  static getAllByFormId(formId, options) { return submissions.getAllByFormId(formId, options); }
  static countByFormId(formId) { return simply.countWhere('submissions', { formId }); }
});

