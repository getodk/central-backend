// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Problem = require('../../util/problem');
const { map } = require('ramda');
const { fieldsForJoin, joinRowToInstance, maybeFirst, translateProblem, QueryOptions, applyPagingOptions } = require('../../util/db');
const { mapStream } = require('../../util/stream');


module.exports = {
  getById: (formId, instanceId, options = QueryOptions.none) => ({ submissions }) =>
    submissions._get(options.withCondition({ formId, instanceId })).then(maybeFirst),

  getAllByFormId: (formId, options = QueryOptions.none) => ({ submissions }) =>
    submissions._get(options.withCondition({ formId })),

  streamRowsByFormId: (formId, options = QueryOptions.none) => ({ submissions }) =>
    submissions.helper.base(options.withCondition({ formId }))
      .pipe(mapStream(submissions.helper.deserializer(options.extended))),

  // The attachment will already contain information about its relationship to this
  // Submission, as it is a join entity.
  createAttachment: (attachment) => ({ simply }) =>
    simply.create('submission_attachments', attachment)
      .catch(translateProblem(
        ((problem) => problem.code === Problem.user.uniquenessViolation({}).code), // TODO: easier comparison
        ((problem) => Problem.user.uniquenessViolation({ fields: [ '(attachment file names)' ], values: [ problem.problemDetails.values[1] ] }))
      )),

  // Returns a hybrid set of information from the Attachments and Blobs tables.
  streamAttachmentsByFormId: (formId) => ({ db }) =>
    db
      .select('submissions.instanceId', 'submission_attachments.name', 'blobs.content', 'blobs.contentType')
      .from('submissions')
      .where({ formId })
      .join('submission_attachments', 'submission_attachments.submissionId', 'submissions.id')
      .join('blobs', 'blobs.id', 'submission_attachments.blobId')
      .stream(),

  _get: (options) => ({ submissions }) =>
    submissions.helper.base(options)
      .then(map(submissions.helper.deserializer(options.extended))),

  helper: {
    // Just returns information from the Submissions table by default. The extended
    // version also expands the submitter property into a full Actor Instance.
    base: (options) => ({ db, Submission, Actor }) => ((options.extended === false)
      ? db.select('*')
        .from('submissions')
        .where(options.condition)
        .where({ deletedAt: null })
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .modify(applyPagingOptions(options))
      : db.select(fieldsForJoin({
        submission: { table: 'submissions', fields: Submission.fields.all },
        submitter: { table: 'actors', fields: Actor.fields.all }
      }))
        .from('submissions')
        .where(options.condition)
        .where({ 'submissions.deletedAt': null })
        .leftOuterJoin(
          db.select('*').from('actors').as('actors'),
          'submissions.submitter', 'actors.id'
        )
        .orderBy('submissions.createdAt', 'desc')
        .orderBy('submissions.id', 'desc')
        .modify(applyPagingOptions(options))),

    deserializer: (extended = false) => ({ Submission, Actor }) => ((extended === false)
      ? ((submission) => new Submission(submission))
      : joinRowToInstance('submission', {
        submission: Submission,
        submitter: Actor
      }))
  }
};

