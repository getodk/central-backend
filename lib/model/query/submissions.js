// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { withJoin, maybeFirst, rowsToInstances, QueryOptions, applyPagingOptions, resultCount } = require('../../util/db');
const { applyODataFilter } = require('../../data/odata-filter');


module.exports = {

  // creates both the submission and its initial submission def in one go.
  // this query is written raw, because knex does not understand the CTE and generates
  // a blank query.
  create: (partial, form, submitterId, deviceId) => ({ db, Submission, SubmissionDef }) => db.raw(`
with def as (insert into submission_defs ("submissionId", xml, "formDefId", "submitterId", "localKey", "encDataAttachmentName", "signature", "createdAt", current)
  values (nextval(pg_get_serial_sequence('submissions', 'id')), ?, ?, ?, ?, ?, ?, now(), true)
  returning *),
ins as (insert into submissions (id, "formId", "instanceId", "submitterId", "deviceId", draft, "createdAt")
  select def."submissionId", ?, ?, def."submitterId", ?, ?, def."createdAt" from def
  returning submissions.*)
select ins.*, def.id as "submissionDefId" from ins, def;`,
  [ partial.xml, form.def.id, submitterId, partial.localKey, partial.encDataAttachmentName, partial.signature,
    form.id, partial.instanceId, deviceId, (form.def.publishedAt == null) ])
    .then(({ rows }) => rows[0])
    .then(({ submissionDefId, ...submissionData }) => ({
      submission: new Submission(submissionData),
      submissionDef: new SubmissionDef({ // TODO/HACK: reassembling this from bits and bobs.
        id: submissionDefId,
        submissionId: submissionData.id,
        xml: partial.xml,
        formDefId: form.def.id,
        submitterId: submissionData.submitterId,
        localKey: partial.localKey,
        encDataAttachmentName: partial.encDataAttachmentName,
        signature: partial.signature,
        createdAt: submissionData.createdAt
      })
    })),

  clearDraftSubmissions: (formId) => ({ db }) =>
    db.delete().from('submissions').where({ formId, draft: true }),

  getById: (formId, instanceId, draft, options = QueryOptions.none) => ({ submissions }) =>
    submissions._get(formId, draft, options.withCondition({ instanceId })).then(maybeFirst),

  getAllByFormId: (formId, draft, options = QueryOptions.none) => ({ submissions }) =>
    submissions._get(formId, draft, options),

  _get: (formId, draft, options) => ({ db, Actor, Submission }) => ((options.extended === false)
    ? db.select('*')
      .from('submissions')
      .where(options.condition)
      .where({ formId, draft, 'submissions.deletedAt': null })
      .orderBy('submissions.id', 'desc')
      .modify(applyPagingOptions(options))
      .then(rowsToInstances(Submission))
    : withJoin('submission', { submission: Submission.Extended, submitter: Actor }, (fields, unjoin) =>
      db.select(fields)
        .from('submissions')
        .where(options.condition)
        .where({ formId, draft, 'submissions.deletedAt': null })
        .leftOuterJoin('actors', 'actors.id', 'submissions.submitterId')
        .orderBy('submissions.createdAt', 'desc')
        .orderBy('submissions.id', 'desc')
        .modify(applyPagingOptions(options))
        .then(map(unjoin)))),

  countByFormId: (formId, draft, options = QueryOptions.none) => ({ db }) =>
    db.count('*').from('submissions')
      .where({ formId, draft, deletedAt: null })
      .modify(applyODataFilter(options.filter))
      .then(resultCount)
};

