// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { compose } = require('ramda');
const { maybeRowToInstance, rowsToInstances, withJoin, applyPagingOptions, ifArg } = require('../../util/db');
const { QueryOptions } = require('../../util/db');
const Option = require('../../util/option');

// common filter conditions used below in get.
const auditFilterer = (options) => compose(
  ifArg('start', options, (start, db) => db.where('loggedAt', '>=', start)),
  ifArg('end', options, (end, db) => db.where('loggedAt', '<=', end)),
  ifArg('action', options, (action, db) => (action === 'nonverbose')
    ? db.whereNotIn('action', [ 'submission.create', 'submission.attachment.update', 'backup' ])
    : db.where({ action }))
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
  get: (options = QueryOptions.none) => ({ db, Actor, Audit, Form, Project }) => ((options.extended === false)
    ? db.select('*').from('audits')
      .where(options.condition)
      .modify(auditFilterer(options))
      .orderBy('loggedAt', 'desc')
      .modify(applyPagingOptions(options))
      .then(rowsToInstances(Audit))
    : withJoin('audit', {
      actor: { Instance: Option.of(Actor), table: 'actor' },
      audit: Audit.Extended,
      actorActee: Option.of(Actor),
      formActee: Option.of(Form),
      projectActee: Option.of(Project)
    }, (fields, unjoin) =>
      db.select(fields)
        .from('audits')
        .where(options.condition)
        .modify(auditFilterer(options))
        .leftOuterJoin(
          db.select('*').from('actors').as('actor'),
          'actor.id', 'audits.actorId'
        )
        .leftOuterJoin('projects', 'projects.acteeId', 'audits.acteeId')
        .leftOuterJoin('actors', 'actors.acteeId', 'audits.acteeId')
        .leftOuterJoin('forms', 'forms.acteeId', 'audits.acteeId')
        .orderBy('loggedAt', 'desc')
        .modify(applyPagingOptions(options))
        .then((rows) => rows.map((row) => {
          const audit = unjoin(row);
          const actees = [ audit.actorActee, audit.formActee, audit.projectActee ];
          return audit
            .without('actorActee', 'formActee', 'projectActee')
            .with({ actee: Option.firstDefined(actees) });
        }))))
};

