// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Instance = require('../instance/instance');
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

  getCurrentByIds: (projectId, xmlFormId, instanceId, draft) => ({ db, SubmissionDef }) =>
    db.select('submission_defs.*')
      .from('submission_defs')
      .innerJoin(
        db.select('submissions.id', 'draftDefId').from('submissions')
          .where({ instanceId, 'submissions.deletedAt': null, draft })
          .innerJoin(
            db.select('id', 'draftDefId').from('forms')
              .where({ projectId, xmlFormId, deletedAt: null })
              .as('forms'),
            'forms.id', 'submissions.formId'
          )
          .as('submissions'),
        ((draft === true)
          ? { 'submissions.id': 'submission_defs.submissionId', 'submission_defs.formDefId': 'draftDefId' }
          : { 'submissions.id': 'submission_defs.submissionId' })
      )
      .orderBy('createdAt', 'desc')
      .limit(1)
      .then(maybeRowToInstance(SubmissionDef)),

  streamForExport: (formId, draft, keyIds, options) => ({ submissionDefs }) =>
    submissionDefs.helper.forExport(formId, draft, keyIds, options)((query, unjoin) =>
      query.pipe(mapStream(unjoin))),

  getForExport: (formId, instanceId, draft) => ({ submissionDefs }) =>
    submissionDefs.helper.forExport(formId, draft)((query, unjoin) =>
      query
        .where({ 'submissions.instanceId': instanceId })
        .then(maybeFirst)
        .then((maybe) => maybe.map(unjoin))),

  helper: {
    forExport: (formId, draft, keyIds = [], options = QueryOptions.none) => ({ db, Actor, Submission, SubmissionDef }) => (observe) =>
      withJoin('def', {
        def: SubmissionDef,
        submission: Submission,
        submitter: Actor,
        attachments: Instance.adHoc('attachments', [ 'present', 'expected' ])
      }, (fields, unjoin) => observe(
        db.select(fields)
          .select({
            // only return the actual xml if we are not encrypted:
            'def!xml': db.raw('case when submission_defs."localKey" is null then submission_defs.xml end'),
            // and indicate whether we even have encrypted xml data (whether or not we return that data):
            'def!encHasData': db.raw('submission_attachments."blobId" is not null')
          })
          .from('submission_defs')
          .innerJoin(
            db.select(db.raw('max(id) as id'))
              .from('submission_defs')
              .groupBy('submissionId')
              .as('latest'),
            'submission_defs.id', 'latest.id'
          )
          .modify((chain) => ((draft === true)
            ? chain.innerJoin(db.select('draftDefId').from('forms').where({ id: formId }).as('forms'),
              'forms.draftDefId', 'submission_defs.formDefId')
            : chain))
          .innerJoin(db.select('*').from('submissions').where({ draft }).as('submissions'),
            'submissions.id', 'submission_defs.submissionId')
          .leftOuterJoin('actors', 'submissions.submitterId', 'actors.id')
          .leftOuterJoin('submission_attachments', {
            'submission_attachments.submissionDefId': 'submission_defs.id',
            'submission_attachments.name': 'submission_defs.encDataAttachmentName'
          })
          .leftOuterJoin(
            db.select(db.raw('"submissionDefId", count("blobId")::integer as present, count(name)::integer as expected'))
              .from('submission_attachments')
              .groupBy('submissionDefId')
              .as('attachments'),
            'attachments.submissionDefId', 'submission_defs.id'
          )
          .modify((chain) => ((keyIds.length === 0)
            ? chain
            : chain.select({
              'def!encData': 'blobs.content',
              'def!encIndex': 'submission_attachments.index',
              'def!encKeyId': 'form_defs.keyId',
            })
              .leftOuterJoin('form_defs', 'form_defs.id', 'submission_defs.formDefId')
              .leftOuterJoin('blobs', 'blobs.id', 'submission_attachments.blobId')
              .where((where) => where
                .whereNull('form_defs.keyId')
                .orWhereIn('form_defs.keyId', keyIds))))
          .where({ 'submissions.formId': formId, 'submissions.deletedAt': null })
          .orderBy('submissions.id', 'desc')
          .modify(applyPagingOptions(options)),
        unjoin
      ))
  }
};

