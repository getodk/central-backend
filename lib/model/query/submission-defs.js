// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { withJoin, maybeFirst, QueryOptions, applyPagingOptions } = require('../../util/db');
const { maybeRowToInstance } = require('../../util/db');
const { mapStream } = require('../../util/stream');

module.exports = {
  getCurrentBySubmissionId: (submissionId) => ({ db, SubmissionDef }) =>
    db.select('*')
      .from('submission_defs')
      .where({ submissionId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .then(maybeRowToInstance(SubmissionDef)),

  getCurrentByIds: (projectId, xmlFormId, instanceId) => ({ db, SubmissionDef }) =>
    db.select('submission_defs.*')
      .from('submission_defs')
      .innerJoin(
        db.select('submissions.id').from('submissions')
          .where({ instanceId })
          .innerJoin(
            db.select('id').from('forms')
              .where({ projectId, xmlFormId, deletedAt: null })
              .as('forms'),
            'forms.id', 'submissions.formId'
          )
          .as('submissions'),
        'submissions.id', 'submission_defs.submissionId'
      )
      .orderBy('createdAt', 'desc')
      .limit(1)
      .then(maybeRowToInstance(SubmissionDef)),

  streamForExport: (formId, options) => ({ submissionDefs }) =>
    submissionDefs.helper.forExport(formId, options)((query, unjoin) =>
      query.pipe(mapStream(unjoin))),

  getForExport: (formId, instanceId) => ({ submissionDefs }) =>
    submissionDefs.helper.forExport(formId)((query, unjoin) =>
      query
        .where({ 'submissions.instanceId': instanceId })
        .then(maybeFirst)
        .then((maybe) => maybe.map(unjoin))),

  helper: {
    forExport: (formId, options = QueryOptions.none) => ({ db, Actor, Submission, SubmissionDef }) => (observe) =>
      withJoin('def', { def: SubmissionDef, submission: Submission, submitter: Actor }, (fields, unjoin) => observe(
        db.select(fields)
          .from('submission_defs')
          .innerJoin(
            db.select(db.raw('max(id) as id'))
              .from('submission_defs')
              .groupBy('submissionId')
              .as('latest'),
            'submission_defs.id', 'latest.id'
          )
          .innerJoin('submissions', 'submissions.id', 'submission_defs.submissionId')
          .leftOuterJoin('actors', 'submissions.submitterId', 'actors.id')
          .where({ 'submissions.formId': formId, 'submissions.deletedAt': null })
          .orderBy('submissions.id', 'desc')
          .modify(applyPagingOptions(options)),
        unjoin
      ))
  }
};

