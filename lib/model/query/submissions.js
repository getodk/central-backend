// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { fieldsForJoin, joinRowToInstance, maybeFirst, rowsToInstances, QueryOptions, applyPagingOptions } = require('../../util/db');


module.exports = {

  // creates both the submission and its initial submission version in one go.
  // this query is written raw, because knex does not understand the CTE and generates
  // a blank query.
  create: (partial, form, actorId, deviceId) => ({ db, Submission, SubmissionVersion }) => db.raw(`
with version as (insert into submission_versions ("submissionId", xml, "xformId", "actorId", "createdAt")
  values (nextval(pg_get_serial_sequence('submissions', 'id')), ?, ?, ?, now())
  returning *),
ins as (insert into submissions (id, "formId", "instanceId", "submitterId", "deviceId", "createdAt")
  select version."submissionId", ?, ?, version."actorId", ?, version."createdAt" from version
  returning submissions.*)
select ins.*, version.id as "subVersionId" from ins, version;`,
  [ partial.xml, form.xform.id, actorId, form.id, partial.instanceId, deviceId ])
    .then(({ rows }) => rows[0])
    .then(({ subVersionId, ...submissionData }) => ({
      submission: new Submission(submissionData),
      submissionVersion: new SubmissionVersion({ // TODO/HACK: reassembling this from bits and bobs.
        id: subVersionId,
        submissionId: submissionData.id,
        xml: partial.xml,
        xformId: form.xform.id,
        actorId: submissionData.submitterId,
        createdAt: submissionData.createdAt
      })
    })),

  getById: (formId, instanceId, options = QueryOptions.none) => ({ submissions }) =>
    submissions._get(options.withCondition({ formId, instanceId })).then(maybeFirst),

  getAllByFormId: (formId, options = QueryOptions.none) => ({ submissions }) =>
    submissions._get(options.withCondition({ formId })),

  _get: (options) => ({ db, Actor, Submission }) => ((options.extended === false)
    ? db.select('*')
      .from('submissions')
      .where(options.condition)
      .where({ deletedAt: null })
      .orderBy('id', 'desc')
      .modify(applyPagingOptions(options))
      .then(rowsToInstances(Submission))
    : db.select(fieldsForJoin({
      submission: Submission.Extended,
      submitter: Actor
    }))
      .from('submissions')
      .where(options.condition)
      .where({ 'submissions.deletedAt': null })
      .leftOuterJoin('actors', 'actors.id', 'submissions.submitterId')
      .orderBy('submissions.id', 'desc')
      .modify(applyPagingOptions(options))
      .then(map(joinRowToInstance('submission', {
        submission: Submission.Extended,
        submitter: Actor
      }))))
};

