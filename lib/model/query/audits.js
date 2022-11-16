// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Actee, Actor, Audit, Dataset, Form, Project } = require('../frames');
const { extender, equals, page, QueryOptions } = require('../../util/db');
const Option = require('../../util/option');
const { construct } = require('../../util/util');


const log = (actor, action, actee, details) => ({ run, context }) => {
  const actorId = Option.of(actor).map((x) => x.id).orNull();
  const acteeId = Option.of(actee).map((x) => x.acteeId).orNull();
  const processed = Audit.actionableEvents.includes(action) ? null : sql`clock_timestamp()`;
  const notes = (context == null) ? null :
    context.headers['x-action-notes'] == null ? null :
    decodeURIComponent(context.headers['x-action-notes']); // eslint-disable-line indent

  return run(sql`
insert into audits ("actorId", action, "acteeId", details, notes, "loggedAt", processed, failures)
values (${actorId}, ${action}, ${acteeId}, ${(details == null) ? null : JSON.stringify(details)}, ${notes}, clock_timestamp(), ${processed}, 0)`);
};


// we explicitly use where..in with a known lookup for performance.
// TODO: some sort of central table for all these things, not here.
const actionCondition = (action) => {
  if (action === 'nonverbose')
    return sql`action not in ('entity.create', 'entity.create.error', 'submission.create', 'submission.update', 'submission.update.version', 'submission.attachment.update', 'backup', 'analytics')`;
  else if (action === 'user')
    return sql`action in ('user.create', 'user.update', 'user.delete', 'user.assignment.create', 'user.assignment.delete', 'user.session.create')`;
  else if (action === 'field_key')
    return sql`action in ('field_key.create', 'field_key.assignment.create', 'field_key.assignment.delete', 'field_key.session.end', 'field_key.delete')`;
  else if (action === 'public_link')
    return sql`action in ('public_link.create', 'public_link.assignment.create', 'public_link.assignment.delete', 'public_link.session.end', 'public_link.delete')`;
  else if (action === 'project')
    return sql`action in ('project.create', 'project.update', 'project.delete')`;
  else if (action === 'form')
    return sql`action in ('form.create', 'form.update', 'form.delete', 'form.restore', 'form.purge', 'form.attachment.update', 'form.submission.export', 'form.update.draft.set', 'form.update.draft.delete', 'form.update.publish')`;
  else if (action === 'submission')
    return sql`action in ('submission.create', 'submission.update', 'submission.update.version', 'submission.attachment.update')`;
  else if (action === 'dataset')
    return sql`action in ('dataset.create', 'dataset.update', 'dataset.update.publish')`;
  else if (action === 'entity')
    return sql`action in ('entity.create', 'entity.create.error')`;

  return sql`action=${action}`;
};


// used entirely by tests only:
const getLatestByAction = (action) => ({ maybeOne }) =>
  maybeOne(sql`select * from audits where action=${action} order by "loggedAt" desc limit 1`)
    .then(map(construct(Audit)));


// filter condition fragment used below in _get.
const auditFilterer = (options) => {
  const result = [];
  options.ifArg('start', (start) => result.push(sql`"loggedAt" >= ${start}`));
  options.ifArg('end', (end) => result.push(sql`"loggedAt" <= ${end}`));
  options.ifArg('action', (action) => result.push(actionCondition(action)));
  return (result.length === 0) ? sql`true` : sql.join(result, sql` and `);
};

const _get = extender(Audit)(Option.of(Actor), Option.of(Actor.alias('actee_actor', 'acteeActor')), Option.of(Form), Option.of(Form.Def), Option.of(Project), Option.of(Dataset), Option.of(Actee))((fields, extend, options) => sql`
select ${fields} from audits
  ${extend|| sql`
    left outer join actors on actors.id=audits."actorId"
    left outer join projects on projects."acteeId"=audits."acteeId"
    left outer join actors as actee_actor on actee_actor."acteeId"=audits."acteeId"
    left outer join forms on forms."acteeId"=audits."acteeId"
    left outer join form_defs on form_defs.id=forms."currentDefId"
    left outer join datasets on datasets."acteeId"=audits."acteeId"
    left outer join actees on actees.id=audits."acteeId"`}
  where ${equals(options.condition)} and ${auditFilterer(options)}
  order by "loggedAt" desc, audits.id desc
  ${page(options)}`);
const get = (options = QueryOptions.none) => ({ all }) =>
  _get(all, options).then((rows) => {
    // we need to actually put the formdef inside the form.
    if (rows.length === 0) return rows;
    if (rows[0].aux.form === undefined) return rows; // not extended

    // TODO: better if we don't have to loop over all this data twice.
    return rows.map((row) => {
      const form = row.aux.form.map((f) => f.withAux('def', row.aux.def));
      const actees = [ row.aux.acteeActor, form, row.aux.project, row.aux.dataset, row.aux.actee ];
      return new Audit(row, { actor: row.aux.actor, actee: Option.firstDefined(actees) });
    });
  });

const _getBySubmissionId = extender(Audit)(Option.of(Actor))((fields, extend, options, submissionId) => sql`
select ${fields} from audits
  ${extend|| sql`left outer join actors on actors.id=audits."actorId"`}
  where (details->'submissionId'::text)=${submissionId}
  order by "loggedAt" desc, audits.id desc
  ${page(options)}`);
const getBySubmissionId = (submissionId, options) => ({ all }) =>
  _getBySubmissionId(all, options, submissionId);


module.exports = { log, getLatestByAction, get, getBySubmissionId };

