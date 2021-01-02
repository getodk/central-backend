// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { compose } = require('ramda');
const { maybeRowToInstance, rowsToInstances, withJoin, applyPagingOptions, ifArg } = require('../../util/db');
const { QueryOptions } = require('../../util/db');
const Option = require('../../util/option');

// we explicitly use where..in with a known lookup for performance.
// TODO: some sort of central table for all these things, not here.
const actionCondition = (action, db) => {
  if (action === 'nonverbose')
    return db.whereNotIn('action', [ 'submission.create', 'submission.attachment.update', 'backup' ]);
  else if (action === 'user')
    return db.whereIn('action', [ 'user.create', 'user.update', 'user.delete', 'assignment.create', 'assignment.delete' ]);
  else if (action === 'project')
    return db.whereIn('action', [ 'project.create', 'project.update', 'project.delete' ]);
  else if (action === 'form')
    return db.whereIn('action', [ 'form.create', 'form.update', 'form.delete', 'form.attachment.update', 'form.update.draft.set', 'form.update.draft.delete', 'form.update.publish' ]);
  else if (action === 'submission')
    return db.whereIn('action', [ 'submission.create', 'submission.attachment.update' ]);

  return db.where({ action });
};

// common filter conditions used below in get.
const auditFilterer = (options) => compose(
  ifArg('start', options, (start, db) => db.where('loggedAt', '>=', start)),
  ifArg('end', options, (end, db) => db.where('loggedAt', '<=', end)),
  ifArg('action', options, actionCondition)
);

module.exports = {
  // "latest" returns only the very newest audit log matching the given condition.
  getLatestWhere: (condition) => ({ db, Audit }) =>
    db.select('*').from('audits')
      .where(condition)
      .orderBy('loggedAt', 'desc')
      .limit(1)
      .then(maybeRowToInstance(Audit)),

  // TODO: still sort of repetitive
  get: (options = QueryOptions.none) => ({ db, Actor, Audit, Form, FormDef, Project }) => ((options.extended === false)
    ? db.select('*').from('audits')
      .where(options.condition)
      .modify(auditFilterer(options))
      .orderBy('loggedAt', 'desc')
      .orderBy('audits.id', 'desc')
      .modify(applyPagingOptions(options))
      .then(rowsToInstances(Audit))
    : withJoin('audit', {
      actor: { Instance: Option.of(Actor), table: 'full_actor' },
      audit: Audit.Extended,
      actorActee: Option.of(Actor),
      formActee: Option.of(Form),
      formDefActee: Option.of(FormDef),
      projectActee: Option.of(Project)
    }, (fields, unjoin) =>
      db.select(fields)
        .from('audits')
        .where(options.condition)
        .modify(auditFilterer(options))
        .leftOuterJoin(
          db.select('*').from('actors').as('full_actor'),
          'full_actor.id', 'audits.actorId'
        )
        .leftOuterJoin('projects', 'projects.acteeId', 'audits.acteeId')
        .leftOuterJoin('actors', 'actors.acteeId', 'audits.acteeId')
        .leftOuterJoin('forms', 'forms.acteeId', 'audits.acteeId')
        .leftOuterJoin('form_defs', 'forms.currentDefId', 'form_defs.id')
        .orderBy('loggedAt', 'desc')
        .orderBy('audits.id', 'desc')
        .modify(applyPagingOptions(options))
        .then((rows) => rows.map((row) => {
          const audit = unjoin(row);
          const formActee = Option.of(audit.formDefActee
            .map((fda) => audit.formActee.get().with({ def: fda }))
            .orElse(audit.formActee));
          const actees = [ audit.actorActee, formActee, audit.projectActee ];
          return audit
            .without('actorActee', 'formActee', 'projectActee')
            .with({ actee: Option.firstDefined(actees) });
        }))))
};

