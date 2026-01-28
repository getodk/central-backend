// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map, mergeLeft } = require('ramda');
const { Actee, Actor, Audit, Dataset, Entity, Form, Project, Submission } = require('../frames');
const { extender, sqlEquals, page, QueryOptions, unjoiner } = require('../../util/db');
const { urlDecode } = require('../../util/http');
const Option = require('../../util/option');
const Problem = require('../../util/problem');
const { construct } = require('../../util/util');

const xActionNotes = 'x-action-notes';

const log = (actor, action, actee, details) => ({ run, context }) => {
  const actorId = Option.of(actor).map((x) => x.id).orNull();
  const acteeId = Option.of(actee).map((x) => x.acteeId).orNull();
  const processed = Audit.actionableEvents.includes(action) ? null : sql`clock_timestamp()`;

  const notes = Option.of(context?.headers[xActionNotes]).map(val => urlDecode(val).orThrow(Problem.user.invalidHeader(xActionNotes))).orNull();

  return run(sql`
insert into audits ("actorId", action, "acteeId", details, notes, "loggedAt", processed, failures)
values (${actorId}, ${action}, ${acteeId}, ${(details == null) ? null : JSON.stringify(details)}, ${notes}, clock_timestamp(), ${processed}, 0)`);
};


// we explicitly use where..in with a known lookup for performance.
// TODO: some sort of central table for all these things, not here.
const actionCondition = (action) => {
  if (action === 'nonverbose')
    // The backup action was logged by a backup script that has been removed.
    // Even though the script has been removed, the audit log entries it logged
    // have not, so we should continue to exclude those.
    return sql`action not in ('entity.create', 'entity.bulk.create', 'entity.error', 'entity.update.version', 'entity.update.resolve', 'entity.delete', 'entity.restore', 'entity.purge', 'submission.create', 'submission.update', 'submission.update.version', 'submission.attachment.update', 'submission.backlog.hold', 'submission.backlog.reprocess', 'submission.backlog.force', 'submission.delete', 'submission.restore', 'user.preference.update', 'user.preference.delete', 'backup', 'analytics')`;
  else if (action === 'user')
    return sql`action in ('user.create', 'user.update', 'user.delete', 'user.assignment.create', 'user.assignment.delete', 'user.session.create')`;
  else if (action === 'field_key')
    return sql`action in ('field_key.create', 'field_key.assignment.create', 'field_key.assignment.delete', 'field_key.session.end', 'field_key.delete')`;
  else if (action === 'public_link')
    return sql`action in ('public_link.create', 'public_link.assignment.create', 'public_link.assignment.delete', 'public_link.session.end', 'public_link.delete')`;
  else if (action === 'project')
    return sql`action in ('project.create', 'project.update', 'project.delete')`;
  else if (action === 'form')
    return sql`action in ('form.create', 'form.update', 'form.delete', 'form.restore', 'form.purge', 'form.attachment.update', 'form.submission.export', 'form.update.draft.set', 'form.update.draft.delete', 'form.update.draft.replace', 'form.update.publish')`;
  else if (action === 'submission')
    return sql`action in ('submission.create', 'submission.update', 'submission.update.version', 'submission.attachment.update', 'submission.backlog.hold', 'submission.backlog.reprocess', 'submission.backlog.force', 'submission.delete', 'submission.restore', 'submission.purge')`;
  else if (action === 'dataset')
    return sql`action in ('dataset.create', 'dataset.update', 'entity.bulk.delete', 'entity.bulk.restore', 'dataset.delete')`;
  else if (action === 'entity')
    return sql`action in ('entity.create', 'entity.bulk.create', 'entity.error', 'entity.update.version', 'entity.update.resolve', 'entity.delete', 'entity.restore', 'entity.purge', 'entity.bulk.delete', 'entity.bulk.restore')`;
  else if (action === 'upgrade')
    return sql`action in ('upgrade.server', 'upgrade.process.form', 'upgrade.process.form.draft', 'upgrade.process.form.entities_version')`;

  return sql`action=${action}`;
};


// used entirely by tests only:
const getLatestByAction = (action) => ({ maybeOne }) =>
  maybeOne(sql`select * from audits where action=${action} order by "loggedAt" desc, id desc limit 1`)
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
  where ${sqlEquals(options.condition)} and ${auditFilterer(options)}
  order by "loggedAt" desc, audits.id desc
  ${page(options)}`);
const get = (options = QueryOptions.none) => ({ all }) =>
  _get(all, options).then((rows) => {
    // we need to actually put the formdef inside the form.
    if (rows.length === 0) return rows;
    if (rows[0].aux.form === undefined) return rows; // not extended

    // TODO: better if we don't have to loop over all this data twice.
    return rows.map((row) => {
      const form = row.aux.form.map((f) =>
        row.aux.def.map((def) => f.withAux('def', def)).orElse(f));
      const actees = [ row.aux.acteeActor, form, row.aux.project, row.aux.dataset, row.aux.actee ];
      return new Audit(row, { actor: row.aux.actor, actee: Option.firstDefined(actees) });
    });
  });

const _getBySubmissionId = extender(Audit)(Option.of(Actor), Option.of(Entity), Option.of(Entity.Def.alias('current_entity_def', 'currentVersion')))((fields, extend, options, submissionId) => sql`
SELECT ${fields} FROM audits
${extend|| sql`
  LEFT OUTER JOIN actors ON actors.id=audits."actorId"

  -- if event references entityId in details
  LEFT JOIN entities ON (audits.details->>'entityId')::INTEGER = entities.id AND entities."deletedAt" IS NULL
  -- join with current entity def even if there is a specific def linked in event
  LEFT JOIN entity_defs AS current_entity_def ON current_entity_def."entityId" = entities.id AND current
`}
  WHERE (audits.details->>'submissionId')::INTEGER = ${submissionId}
  ORDER BY audits."loggedAt" DESC, audits.id DESC
  ${page(options)}`);

const getBySubmissionId = (submissionId, options) => ({ all }) => _getBySubmissionId(all, options, submissionId)
  .then(map(audit => {
    if (audit.aux.entity == null)
      return audit;

    // If an audit event is about an entity, merge in additional entity details
    const fullEntity = audit.aux.entity
      .map(s => s.withAux('currentVersion', audit.aux.currentVersion))
      .map(s => s.forApi());

    const entity = mergeLeft(audit.details.entity, fullEntity.orElse(undefined));

    return new Audit({ ...audit, details: { ...audit.details, entity } }, { actor: audit.aux.actor });
  }));

// Get every audit for an entity. Some audits do not directly reference the
// entity or def, but instead reference a shared source, e.g. `entity.bulk.create` events.
// Fetching these events is done by looking at every Def of an Entity and the
// Source of that Def, then getting audits that reference either the Entity Def
// itself or the Source.
//
// This query also joins in other things linked from the Source, including:
// - The source's triggering event (e.g. an entity update event) and event actor
// - a submission creation event (and actor) IF a submission was part of the source.
//   (This submission creation event is not necessarily the same as the triggering event
//    but it can be.)
//
// This second part to get a submission creation event is to get basic information
// (mainly instanceId) about the source submission, even if it has been deleted.
//
// There is a separate query below to assemble full submission details for non-deleted
// submissions, but it was far too slow to have be part of this query.
const _getByEntityId = (fields, options, entityId) => sql`
SELECT ${fields} FROM (
    SELECT audits.* FROM audits 
    JOIN entities ON (audits.details->'entity'->>'uuid')::uuid = entities.uuid
    WHERE entities.id = ${entityId}
    UNION ALL
    SELECT audits.* FROM audits
    JOIN entity_def_sources ON (audits.details->>'sourceId')::INTEGER = entity_def_sources.id
    JOIN entity_defs ON entity_def_sources.id = entity_defs."sourceId"
    WHERE entity_defs."entityId" = ${entityId} AND audits.action = 'entity.bulk.create'
    UNION ALL
    SELECT audits.* FROM audits
    JOIN entities ON (audits.details->'entityUuids') @> jsonb_build_array(entities.uuid::text) AND (audits.action = 'entity.bulk.delete' OR audits.action = 'entity.bulk.restore')
    WHERE entities.id = ${entityId}
  ) audits

  LEFT JOIN entity_defs ON (audits.details->>'entityDefId')::INTEGER = entity_defs.id
  LEFT JOIN entity_def_sources ON entity_defs."sourceId" = entity_def_sources.id OR (audits.details->>'sourceId')::INTEGER = entity_def_sources.id
  LEFT JOIN actors ON actors.id=audits."actorId"

  LEFT JOIN audits triggering_event ON entity_def_sources."auditId" = triggering_event.id
  LEFT JOIN actors triggering_event_actor ON triggering_event_actor.id = triggering_event."actorId"

  -- if triggering event has a submissionId defined, look up creation event for that submission
  -- it has info about the submission and creator we want to show even if the submission is deleted
  LEFT JOIN audits submission_create_event ON (triggering_event.details->'submissionId')::INTEGER = (submission_create_event.details->'submissionId')::INTEGER AND submission_create_event.action = 'submission.create'
  LEFT JOIN actors submission_create_event_actor ON submission_create_event_actor.id = submission_create_event."actorId"

  ORDER BY audits."loggedAt" DESC, audits.id DESC
    ${page(options)}`;

// Get the full and current Submission linked to each Entity Def of a given Entity.
// If an Entity is created or updated by a Submission, that Entity Def is linked
// (via Entity Def Source) to the specific Submission Def that modified it.
// This query gets all relevant info about each Submission Def linked to each Def
// in an Entity.
//
// It can handle a variety of situations including:
// - The Def did not come from a Submission
// - The Submission has been purged, possibly by purging the whole Form
// - The Form has been soft-deleted so the Submission should not be returned
// - The Submission has been soft-deleted (though this is not possible to do)
//
// It will return the CURRENT version of the Dubmission rather than the version
// used to create the Entity Def (used to display updated Submission instanceName).
const _getEntityDefsWithSubs = (fields, entityId) => sql`
SELECT ${fields} FROM entity_defs
  LEFT JOIN entity_def_sources on entity_def_sources.id = entity_defs."sourceId"

  -- if source submissionDefId is defined:
  LEFT JOIN (
    (
      SELECT submissions.*, submission_defs."userAgent" FROM submissions
      JOIN submission_defs ON submissions.id = submission_defs."submissionId" AND root AND submissions."deletedAt" IS NULL
    ) submissions
    JOIN forms
      ON forms.id = submissions."formId" AND forms."deletedAt" IS NULL
        AND submissions."deletedAt" IS NULL
    JOIN submission_defs AS current_submission_def
      ON submissions.id = current_submission_def."submissionId" AND current
    JOIN submission_defs AS linked_submission_def
      ON submissions.id = linked_submission_def."submissionId"
  ) on linked_submission_def.id = entity_def_sources."submissionDefId"

  LEFT JOIN actors submission_actor ON submission_actor.id = submissions."submitterId"
  LEFT JOIN actors current_submission_actor on current_submission_actor.id=current_submission_def."submitterId"

  WHERE entity_defs."entityId" = ${entityId}
  ORDER BY entity_defs.id DESC;
`;

const getByEntityId = (entityId, options) => ({ all }) => {

  const _unjoiner = unjoiner(
    Audit, Actor, Entity.Def, Entity.Def.Source,
    Option.of(Audit.alias('triggering_event', 'triggeringEvent')), Option.of(Actor.alias('triggering_event_actor', 'triggeringEventActor')),
    Option.of(Audit.alias('submission_create_event', 'submissionCreateEvent')), Option.of(Actor.alias('submission_create_event_actor', 'submissionCreateEventActor')),
  );

  const _defUnjoiner = unjoiner(
    Entity.Def, Entity.Def.Source,
    Option.of(Submission), Option.of(Submission.Def.alias('current_submission_def', 'currentVersion')),
    Option.of(Actor.alias('current_submission_actor', 'currentSubmissionActor')),
    Option.of(Actor.alias('submission_actor', 'submissionActor')),
    Option.of(Form)
  );

  return Promise.all([
    all(_getByEntityId(_unjoiner.fields, options, entityId)).then(map(_unjoiner)),
    all(_getEntityDefsWithSubs(_defUnjoiner.fields, entityId)).then(map(_defUnjoiner))
  ])
    .then(([audits, defsWithSubs]) => {
      // Build a map of Entity Def Ids to objects that contain full Submission information
      // linked to that Def (if Submission exists and if Def is even linked to a Submission).
      const entityDefDict = Object.fromEntries(defsWithSubs.map(def => [def.id, def]));

      return audits.map(audit => {
        const entitySourceDetails = audit.aux.source.forApi();

        const sourceEvent = audit.aux.triggeringEvent
          .map(a => a.withAux('actor', audit.aux.triggeringEventActor.orNull()))
          .map(a => a.forApi());

        // If the entity event is based on a submission, get submission details from the submission create event,
        // which should always exist, even if the entity has been deleted.
        const baseSubmission = audit.aux.submissionCreateEvent.map((createEvent) =>
          ({
            instanceId: createEvent.details.instanceId,
            createdAt: createEvent.loggedAt,
            submitter: audit.aux.submissionCreateEventActor.get().forApi()
          }))
          .orElse(undefined);

        // Look up the full Submission information and attempt to merge it in if it exists.
        const subOption = entityDefDict[audit.aux.def.id];
        let submission;

        if (subOption) {
          const fullSubmission = subOption.aux.submission
            .map(s => s.withAux('submitter', subOption.aux.submissionActor.orNull()))
            .map(s => s.withAux('currentVersion', subOption.aux.currentVersion.map(v => v.withAux('submitter', subOption.aux.currentSubmissionActor.orNull()))))
            .map(s => s.forApi())
            .map(s => mergeLeft(s, { xmlFormId: subOption.aux.form.map(f => f.xmlFormId).orNull() }));

          submission = mergeLeft(baseSubmission, fullSubmission.orElse(undefined));
        }

        // Note: The source added to each audit event represents the source of the
        // corresponding entity _version_, rather than the source of the event.
        const details = mergeLeft(audit.details, sourceEvent
          .map(event => ({ source: { event, submission } }))
          .orElse({ source: entitySourceDetails }));

        return new Audit({ ...audit, details }, { actor: audit.aux.actor });
      });
    });
};


module.exports = {
  log, getLatestByAction, get,
  getBySubmissionId, getByEntityId
};

