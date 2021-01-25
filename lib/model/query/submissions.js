// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { map } = require('ramda');
const { sql } = require('slonik');
const { Actor, Submission } = require('../frames');
const { extender, where, page, QueryOptions } = require('../../util/db');
const { odataFilter } = require('../../data/odata-filter');


// creates both the submission and its initial submission def in one go.
const create = (partial, form, submitterId, deviceId) => ({ q, Submission, SubmissionDef }) => q.one(sql`
with def as (insert into submission_defs ("submissionId", xml, "formDefId", "submitterId", "localKey", "encDataAttachmentName", "signature", "createdAt", current)
  values (nextval(pg_get_serial_sequence('submissions', 'id')), ${sql.binary(partial.xml)}, ${form.def.id}, ${submitterId}, ${partial.localKey}, ${partial.encDataAttachmentName}, ${partial.signature}, now(), true)
  returning *),
ins as (insert into submissions (id, "formId", "instanceId", "submitterId", "deviceId", draft, "createdAt")
  select def."submissionId", ${form.id}, ${partial.instanceId}, def."submitterId", ${deviceId}, ${form.def.publishedAt == null}, def."createdAt" from def
  returning submissions.*)
select ins.*, def.id as "submissionDefId" from ins, def;`)
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
  }));

const clearDraftSubmissions = (formId) => ({ q }) => q.query(sql`
delete from submissions where "formId"=${formId} and draft=true`);


const _get = extender(Submission)(Actor)((fields, options, extend) => sql`
select ${fields} from submissions
  ${extend|| sql`left outer join actors on actors.id=submissions."submitterId"`}
  where ${where(options.condition)} and submissions."deletedAt" is null
  order by submissions."createdAt" desc, submissions.id desc
  ${page(options)}`);

const getById = (formId, instanceId, draft, options = QueryOptions.none) => ({ maybeOne }) =>
  _get(maybeOne, options.withCondition({ formId, instanceId, draft }));

const getAllByFormId = (formId, draft, options = QueryOptions.none) => ({ all }) =>
  _get(all, options.withCondition({ formId, draft }));

const countByFormId = (formId, draft, options = QueryOptions.none) => ({ q }) => q.oneFirst(sql`
select count(*) from submissions
  where ${where({ formId, draft })} and "deletedAt" is null ${odataFilter(sql`and`, options.filter)}`);


module.exports = { create, clearDraftSubmissions, getById, getAllByFormId, countByFormId };

