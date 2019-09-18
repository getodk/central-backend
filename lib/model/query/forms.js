// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Option = require('../../util/option');
const { merge, head, map } = require('ramda');
const { maybeFirst, withJoin, QueryOptions } = require('../../util/db');

module.exports = {
  create: (form) => ({ db, actees, forms }) =>
    actees.provision('form')
      .then((actee) => db.raw(`
with def as (insert into form_defs ("formId", xml, hash, sha, sha256, version, "keyId", "createdAt")
  values (nextval(pg_get_serial_sequence('forms', 'id')), ?, ?, ?, ?, ?, ?, now())
  returning *),
form as (insert into forms (id, name, "xmlFormId", state, "projectId", "currentDefId", "acteeId", "createdAt")
  select def."formId", ?, ?, ?, ?, def.id, ?, def."createdAt" from def
  returning forms.*)
select id from form;`,
      [ form.def.xml, form.def.hash, form.def.sha, form.def.sha256, form.def.version, form.def.keyId,
        form.name, form.xmlFormId, form.state || 'open', form.projectId, actee.id ])) // TODO: don't like defaulting state here.
      // we just re-request because we never have all the information together
      // in one query and anyway this operation isn't all that performance-critical.
      .then(({ rows }) => rows[0])
      .then(({ id }) => forms.getWhere({ 'forms.id': id }))
      .then(head), // we have big problems if this can't be assumed present.

  getWhere: (condition, options = QueryOptions.none) => ({ forms }) =>
    forms._get(options.withCondition(condition)),

  getByProjectAndXmlFormId: (projectId, xmlFormId, options = QueryOptions.none) => ({ forms }) =>
    forms._get(options.withCondition({ projectId, xmlFormId })).then(maybeFirst),

  getForOpenRosa: (condition = {}) => ({ db, Form, FormDef }) =>
    withJoin('form', { form: Form, def: FormDef }, (fields, unjoin) =>
      db.select(merge(fields, { 'form!hasAttachments': 'hasAttachments' }))
        .from('forms')
        .whereNotIn('state', [ 'closing', 'closed' ])
        .where(condition)
        .where({ deletedAt: null })
        .leftOuterJoin(
          db.select('*').from('form_defs').as('form_defs'),
          'form_defs.id', 'forms.currentDefId'
        )
        .leftOuterJoin(
          db.select(db.raw('"formDefId", (count("formDefId") > 0) as "hasAttachments"'))
            .from('form_attachments')
            .groupBy('formDefId')
            .as('fa'),
          'forms.currentDefId', 'fa.formDefId'
        )
        // TODO: this was copypasta from below.
        .orderBy(db.raw('coalesce(forms."name", forms."xmlFormId")'), 'asc')
        .then(map(unjoin))),

  // by default, just returns information from this table. the extended version
  // joins against the submissions table to return some metadata based on it
  // (submission count and latest submission time), as well as the audits and actors
  // table for information on the creator of the form.
  //
  // the modifier allows custom chaining to be inserted into the query, which is used
  // above in getOpen().
  _get: (options = QueryOptions.none) => ({ db, Form, Actor, FormDef }) => ((options.extended === false)
    ? withJoin('form', { form: Form, def: FormDef }, (fields, unjoin) =>
      db.select(fields)
        .from('forms')
        .where(options.condition)
        .where({ deletedAt: null })
        .leftOuterJoin(
          db.select('*').from('form_defs').as('form_defs'),
          'form_defs.id', 'forms.currentDefId'
        )
        .orderBy(db.raw('coalesce("name", "xmlFormId")'), 'asc')
        .then(map(unjoin)))
    : withJoin('form', { form: Form.Extended, def: FormDef, createdBy: Option.of(Actor) }, (fields, unjoin) =>
      db.select(fields)
        .from('forms')
        .where(options.condition)
        .leftOuterJoin(
          db.select('*').from('form_defs').as('form_defs'),
          'form_defs.id', 'forms.currentDefId'
        )
        .leftOuterJoin(
          db.select(db.raw('"formId", count(id)::integer as "submissions", max("createdAt") as "lastSubmission"'))
            .from('submissions')
            .groupBy('formId')
            .as('submission_stats'),
          'forms.id', 'submission_stats.formId'
        )
        .leftOuterJoin(
          db.select('*').from('audits').where({ action: 'form.create' }).as('audits'),
          'forms.acteeId', 'audits.acteeId'
        )
        .leftOuterJoin(
          db.select('*').from('actors').as('actors'),
          'audits.actorId', 'actors.id'
        )
        .where({ 'forms.deletedAt': null })
        .orderBy(db.raw('coalesce(forms."name", forms."xmlFormId")'), 'asc')
        .then(map(unjoin))))
};

