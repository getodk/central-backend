// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Option = require('../../util/option');
const { merge } = require('ramda');
const { fieldsForJoin, joinRowToInstance, rowsToInstances, maybeFirst, QueryOptions } = require('../../util/db');

module.exports = {
  create: (form) => ({ actees, db, forms }) =>
    actees.provision('form')
      // this is written in raw SQL because when i try to express it in knex it outputs
      // a blank statement and sends it to postgres. i think the CTE insertion is just
      // too complex for knex; specifically the with … insert … select formulation.
      .then((actee) => db.raw(`
        with form as (
          insert into forms
            ("projectId", "xmlFormId", state, name, "acteeId", "currentDefinitionId", "createdAt")
            values (?, ?, ?, ?, ?, nextval(pg_get_serial_sequence('definitions', 'id')), now())
            returning *)
        insert into definitions
          (id, xml, hash, version, "formId", "createdAt")
          select form."currentDefinitionId", ?, ?, ?, form.id, now() from form
          returning "formId"`,
        [ form.projectId, form.xmlFormId, form.state || 'open', form.name || null, actee.id,
        form.definition.xml, form.definition.hash, form.definition.version ]
      ))
      // we just re-request because extracting all the necessary fields inline with the
      // CTE insert is some sort of advanced mathematics and anyway this operation isn't
      // all that performance-critical.
      .then(({ rows }) => forms.getWhere({ 'forms.id': rows[0].formId }))
      .then(([ form ]) => form), // we have big problems if this can't be assumed present.

  getWhere: (condition, options = QueryOptions.none) => ({ forms }) =>
    forms._get(options.withCondition(condition)),

  getForOpenRosa: (condition = {}) => ({ db, Form, Definition }) =>
    db.select(merge(
      fieldsForJoin({ form: Form, definition: Definition }),
      { 'form!hasAttachments': 'hasAttachments' }
    ))
      .from('forms')
      .whereNotIn('state', [ Form.states().closing, Form.states().closed ])
      .where(condition)
      .where({ deletedAt: null })
      .leftOuterJoin(
        db.select('*').from('definitions').as('definitions'),
        'definitions.id', 'forms.currentDefinitionId')
      .leftOuterJoin(
        db.select(db.raw('"definitionId", (count("definitionId") > 0) as "hasAttachments"'))
          .from('form_attachments')
          .groupBy('definitionId')
          .as('fa'),
        'forms.currentDefinitionId', 'fa.definitionId'
      )
      // TODO: this was copypasta from below.
      .orderBy(db.raw('coalesce(forms."name", forms."xmlFormId")'), 'asc')
      .then((rows) => rows.map(joinRowToInstance('form', {
        form: Form,
        definition: Definition
      }))),

  // by default, just returns information from this table. the extended version
  // joins against the submissions table to return some metadata based on it
  // (submission count and latest submission time), as well as the audits and actors
  // table for information on the creator of the form.
  //
  // the modifier allows custom chaining to be inserted into the query, which is used
  // above in getOpen().
  _get: (options = QueryOptions.none) => ({ db, Form, Actor, Definition }) => ((options.extended === false)
    ? db.select(fieldsForJoin({ form: Form, definition: Definition }))
      .from('forms')
      .where(options.condition)
      .where({ deletedAt: null })
      .leftOuterJoin(
        db.select('*').from('definitions').as('definitions'),
        'definitions.id', 'forms.currentDefinitionId')
      .orderBy(db.raw('coalesce("name", "xmlFormId")'), 'asc')
      .then((rows) => rows.map(joinRowToInstance('form', {
        form: Form,
        definition: Definition
      })))
    : db.select(fieldsForJoin({ form: Form.Extended, definition: Definition.Extended, createdBy: Actor }))
      .from('forms')
      .where(options.condition)
      .leftOuterJoin(
        db.select('*').from('definitions').as('definitions'),
        'definitions.id', 'forms.currentDefinitionId')
      .leftOuterJoin(
        db.select(db.raw('"definitionId", count(id)::integer as "submissions", max("createdAt") as "lastSubmission"'))
          .from('submissions')
          .groupBy('definitionId')
          .as('submission_stats'),
        'definitions.id', 'submission_stats.definitionId'
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
      .then((rows) => rows.map(joinRowToInstance('form', {
        form: Form.Extended,
        definition: Definition.Extended,
        createdBy: Option.of(Actor)
      }))))
};

